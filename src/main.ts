import { OffChainStorageTestContract } from './OffChainStorageTestContract.js';
import {
  isReady,
  Field,
  Mina,
  PrivateKey,
  AccountUpdate,
  Experimental,
  Poseidon,
  fetchAccount,
  Bool,
} from 'snarkyjs';

import offChainStorage from './offChainStorage.js';

let transactionFee = 10_000_000;

(async function main() {
  await isReady;

  console.log('SnarkyJS loaded');

  const useLocalBlockchain = true;

  const Local = Mina.LocalBlockchain();
  if (useLocalBlockchain) {
    Mina.setActiveInstance(Local);
  } else {
    const Berkeley = Mina.BerkeleyQANet(
      'https://proxy.berkeley.minaexplorer.com/graphql'
    );
    Mina.setActiveInstance(Berkeley);
  }

  let deployerAccount: PrivateKey;
  let zkAppPrivateKey: PrivateKey;
  if (useLocalBlockchain) {
    deployerAccount = Local.testAccounts[0].privateKey;
    zkAppPrivateKey = PrivateKey.random();
  } else {
    deployerAccount = PrivateKey.fromBase58(process.argv[2]);
    zkAppPrivateKey = PrivateKey.fromBase58(process.argv[3]);

    let response = await fetchAccount({
      publicKey: deployerAccount.toPublicKey(),
    });
    if (response.error) throw Error(response.error.statusText);
    let { nonce, balance } = response.account;
    console.log(
      `Using fee payer account with nonce ${nonce}, balance ${balance}`
    );
  }

  // ----------------------------------------------------

  const height = 4;
  class MerkleWitness extends Experimental.MerkleWitness(height) {}

  // create a destination we will deploy the smart contract to
  const zkAppAccount = zkAppPrivateKey.toPublicKey();

  console.log('using zkApp account at', zkAppAccount.toBase58());

  const serverAddress = 'http://localhost:3001';

  const serverPublicKey = offChainStorage.get_public_key(serverAddress);

  if (!useLocalBlockchain) {
    console.log('Compiling smart contract...');
    await OffChainStorageTestContract.compile();
  }

  const zkAppInstance = new OffChainStorageTestContract(zkAppAccount);

  let isDeployed = false;
  if (!useLocalBlockchain) {
    let response = await fetchAccount({ publicKey: zkAppAccount });
    if (response.error == null) {
      isDeployed = true;
    }
  }

  if (!isDeployed) {
    console.log('Deploying zkapp...');
    const deploy_txn = await Mina.transaction(
      { feePayerKey: deployerAccount, fee: transactionFee },
      () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
        zkAppInstance.init(serverPublicKey);
        zkAppInstance.sign(zkAppPrivateKey);
      }
    );
    const res = await deploy_txn.send();

    if (!useLocalBlockchain) {
      const hash = await res.hash(); // This will change in a future version of SnarkyJS
      if (hash == null) {
        console.log('error sending transaction (see above)');
      } else {
        console.log(
          'See deploy transaction at',
          'https://berkeley.minaexplorer.com/transaction/' + hash
        );
      }
    } else {
      isDeployed = true;
    }
  }

  while (!isDeployed) {
    console.log('waiting for zkApp to be deployed...');
    let response = await fetchAccount({ publicKey: zkAppAccount });
    isDeployed = response.error == null;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // get the initial state of IncrementSecret after deployment
  let root;
  if (useLocalBlockchain) {
    root = await zkAppInstance.root.get();
  } else {
    root = (await zkAppInstance.root.fetch())!;
  }
  console.log('state after init:', root.toString());

  const make_transaction = async (root: Field) => {
    const tree = new Experimental.MerkleTree(height);

    const idx2fields = offChainStorage.get(
      serverAddress,
      zkAppAccount,
      height,
      root
    );
    for (let [idx, fields] of idx2fields) {
      tree.setLeaf(BigInt(idx), Poseidon.hash(fields));
    }

    const index = Math.floor(Math.random() * 2 ** (height - 1));
    const leafIsEmpty = Bool(!idx2fields.has(index));

    const oldNum = leafIsEmpty.toBoolean()
      ? Field.fromNumber(0)
      : idx2fields.get(index)![0];
    const newNum = oldNum.add(1);
    const witness = tree.getWitness(BigInt(index));
    const circuitWitness = new MerkleWitness(witness);
    tree.setLeaf(BigInt(index), Poseidon.hash([newNum]));
    const newRoot = tree.getRoot();

    console.log('updating to new root', newRoot.toString());
    console.log('root from ', zkAppInstance.root.get().toString());

    idx2fields.set(index, [newNum]);
    const [newRootNumber, newRootSignature] = offChainStorage.request_store(
      serverAddress,
      zkAppAccount,
      height,
      idx2fields
    );

    // ----------------------------------------------------

    if (!useLocalBlockchain) {
      await fetchAccount({ publicKey: deployerAccount.toPublicKey() });
    }
    const txn1 = await Mina.transaction(
      { feePayerKey: deployerAccount, fee: transactionFee },
      () => {
        zkAppInstance.update(
          leafIsEmpty,
          oldNum,
          newNum,
          circuitWitness,
          newRoot,
          newRootNumber,
          newRootSignature
        );
        zkAppInstance.sign(zkAppPrivateKey);
      }
    );

    if (!useLocalBlockchain) {
      console.log('Creating an execution proof...');
      const time0 = Date.now();
      await txn1.prove();
      const time1 = Date.now();
      console.log('creating proof took', (time1 - time0) / 1e3, 'seconds');
    }

    console.log('Sending the transaction...');
    const res = await txn1.send();

    if (!useLocalBlockchain) {
      const hash = await res.hash(); // This will change in a future version of SnarkyJS
      if (hash == null) {
        console.log('error sending transaction (see above)');
      } else {
        console.log(
          'See transaction at',
          'https://berkeley.minaexplorer.com/transaction/' + hash
        );
      }

      let stateChange = false;

      let root2;
      while (!stateChange) {
        console.log(
          'waiting for zkApp state to change... (current state: ',
          root.toString() + ')'
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        root2 = await zkAppInstance.root.fetch();
        stateChange = root2 != null && root2.equals(root).not().toBoolean();
      }
    }

    let root2;
    if (useLocalBlockchain) {
      root2 = await zkAppInstance.root.get();
    } else {
      root2 = (await zkAppInstance.root.fetch())!;
    }
    console.log('state after txn:', root2.toString());

    return root2;
  };

  let nextRoot = root;
  for (;;) {
    nextRoot = await make_transaction(nextRoot);
  }

  // ----------------------------------------------------

  // console.log('Shutting down');

  // await shutdown();
})();
