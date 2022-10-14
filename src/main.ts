import { OffChainStorageTestContract } from './OffChainStorageTestContract.js';
import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  AccountUpdate,
  Experimental,
  Poseidon,
  Bool,
} from 'snarkyjs';

import { strict as assert } from 'assert';

import offChainStorage from './offChainStorage.js';

(async function main() {
  await isReady;

  console.log('SnarkyJS loaded');

  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const deployerAccount = Local.testAccounts[0].privateKey;

  // ----------------------------------------------------

  const height = 4;
  class MerkleWitness extends Experimental.MerkleWitness(height) {}

  // create a destination we will deploy the smart contract to
  const zkAppPrivateKey = PrivateKey.random();
  const zkAppAddress = zkAppPrivateKey.toPublicKey();

  const serverAddress = 'http://localhost:3001';

  const serverPublicKey = offChainStorage.get_public_key(serverAddress);

  // create an instance of IncrementSecret - and deploy it to zkAppAddress
  const zkAppInstance = new OffChainStorageTestContract(zkAppAddress);
  const deploy_txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
    zkAppInstance.init(Field.fromNumber(height), serverPublicKey);
    zkAppInstance.sign(zkAppPrivateKey);
  });
  await deploy_txn.send().wait();

  // get the initial state of IncrementSecret after deployment
  const root = zkAppInstance.root.get();
  console.log('state after init:', root.toString());

  const tree = new Experimental.MerkleTree(height);

  const idx2fields = offChainStorage.get(
    serverAddress,
    zkAppAddress,
    height,
    root
  );
  for (let [idx, fields] of idx2fields) {
    tree.setLeaf(BigInt(idx), Poseidon.hash(fields));
  }

  const num = Field.fromNumber(42);
  const index = 3;
  assert(!idx2fields.has(index));
  const leafIsEmpty = Bool(true);
  const oldNum = Field.fromNumber(0);
  const witness = tree.getWitness(BigInt(index));
  const circuitWitness = new MerkleWitness(witness);
  tree.setLeaf(BigInt(index), Poseidon.hash([num]));
  const newRoot = tree.getRoot();

  idx2fields.set(index, [num]);
  const [newRootNumber, newRootSignature] = offChainStorage.request_store(
    serverAddress,
    zkAppAddress,
    height,
    idx2fields
  );

  // ----------------------------------------------------

  const txn1 = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.update(
      leafIsEmpty,
      oldNum,
      num,
      circuitWitness,
      newRoot,
      newRootNumber,
      newRootSignature
    );
    zkAppInstance.sign(zkAppPrivateKey);
  });
  await txn1.send().wait();

  const root2 = zkAppInstance.root.get();
  console.log('state after txn1:', root2.toString());

  // ----------------------------------------------------

  console.log('Shutting down');

  await shutdown();
})();
