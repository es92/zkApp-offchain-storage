//const cors = require('cors');
import express from 'express';
import fs from 'fs';

import {
  isReady,
  PrivateKey,
  Field,
  Experimental,
  Poseidon,
  Signature,
  PublicKey,
  fetchAccount,
  Mina,
} from 'snarkyjs';

await isReady;

console.log('THIS IS A REFERENCE IMPLEMENTATION. NOT TO BE USED IN PRODUCTION');

const app = express();
const port = 3001;

app.use(express.json());

// ==============================================================================

const useLocalBlockchain = false;

const Local = Mina.LocalBlockchain();
if (useLocalBlockchain) {
  Mina.setActiveInstance(Local);
} else {
  const Berkeley = Mina.BerkeleyQANet(
    'https://proxy.berkeley.minaexplorer.com/graphql'
  );
  Mina.setActiveInstance(Berkeley);
}

const saveFile = 'database.json';

// ==============================================================================

type data_obj_map = {
  [root: string]: { rootNumber: number; items: Array<[number, string[]]> };
};

let database: {
  [zkAppAddress: string]: {
    nextNumber: number;
    height: number;
    root2data: data_obj_map;
  };
} = {};

let serverPrivateKey: PrivateKey;
if (fs.existsSync(saveFile)) {
  var fileData = fs.readFileSync(saveFile, 'utf8');
  const data = JSON.parse(fileData);
  database = data.database;
  serverPrivateKey = PrivateKey.fromBase58(data.serverPrivateKey58);
  console.log('found database');
} else {
  serverPrivateKey = PrivateKey.random();

  fs.writeFileSync(
    saveFile,
    JSON.stringify({
      database,
      serverPrivateKey58: serverPrivateKey.toBase58(),
    }),
    'utf8'
  );
}

const serverPublicKey = serverPrivateKey.toPublicKey();

console.log('Server using public key', serverPublicKey.toBase58());

// ==============================================================================

(async () => {
  for (;;) {
    console.log('running cleanup');

    for (let zkAppAddress in database) {
      let response = await fetchAccount({
        publicKey: PublicKey.fromBase58(zkAppAddress),
      });
      if (response.account != null) {
        let accountRootNumberF = Field(response.account.appState![1]);
        let accountRootNumber = accountRootNumberF.toBigInt();
        var root2data = database[zkAppAddress].root2data;
        database[zkAppAddress].root2data = {};
        console.log('cleaning up', zkAppAddress);
        for (let root in root2data) {
          if (root2data[root].rootNumber >= accountRootNumber) {
            database[zkAppAddress].root2data[root] = root2data[root];
          }
        }
      }
    }

    fs.writeFileSync(
      saveFile,
      JSON.stringify({
        database,
        serverPrivateKey58: serverPrivateKey.toBase58(),
      }),
      'utf8'
    );

    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
})();

// ==============================================================================

app.post('/data', (req, res) => {
  const height: number = req.body.height;
  const items: Array<[number, string[]]> = req.body.items;
  const zkAppAddress58: string = req.body.zkAppAddress;

  const fieldItems: Array<[number, Field[]]> = items.map(([idx, strs]) => [
    idx,
    strs.map((s) => Field.fromString(s)),
  ]);

  const idx2fields = new Map<number, Field[]>();

  fieldItems.forEach(([index, fields]) => {
    idx2fields.set(index, fields);
  });

  const tree = new Experimental.MerkleTree(height);

  for (let [idx, fields] of idx2fields) {
    tree.setLeaf(BigInt(idx), Poseidon.hash(fields));
  }

  if (height > 8) {
    res.send(
      'height is too large. A max height of 8 is supported for this implementation'
    ); // TODO make this a proper error
    return;
  }

  if (items.length > 2 ** (height - 1)) {
    res.send('too many items for height'); // TODO make this a proper error
    return;
  }

  if (!(zkAppAddress58 in database)) {
    database[zkAppAddress58] = {
      nextNumber: 1,
      height,
      root2data: {},
    };
  }

  if (database[zkAppAddress58].height != height) {
    res.send('wrong height'); // TODO make this a proper error
    return;
  }

  const newRoot = tree.getRoot();
  const newRootNumber = Field.fromNumber(database[zkAppAddress58].nextNumber);

  database[zkAppAddress58].nextNumber += 1;
  database[zkAppAddress58].root2data[newRoot.toString()] = {
    rootNumber: Number(newRootNumber.toBigInt()),
    items,
  };

  fs.writeFileSync(
    saveFile,
    JSON.stringify({
      database,
      serverPrivateKey58: serverPrivateKey.toBase58(),
    }),
    'utf8'
  );

  let newRootSignature = Signature.create(serverPrivateKey, [
    newRoot,
    newRootNumber,
  ]);

  console.log('storing', zkAppAddress58, newRoot.toString());

  res.json({
    result: [
      newRootNumber.toString(),
      newRootSignature.toFields().map((f) => f.toString()),
    ],
    unaudited: true,
  });
});

// ==============================================================================

app.get('/data', (req, res) => {
  const zkAppAddress58 = req.query.zkAppAddress;
  const root = req.query.root;

  if (typeof zkAppAddress58 == 'string' && typeof root == 'string') {
    console.log('getting', zkAppAddress58, root);
    res.json({
      items: database[zkAppAddress58].root2data[root].items,
      unaudited: true,
    });
  } else {
    res.send('bad query parameters');
  }
});

// ==============================================================================

app.get('/public_key', (req, res) => {
  res.json({
    serverPublicKey58: serverPublicKey.toBase58(),
    unaudited: true,
  });
});

// ==============================================================================

app.listen(port, () =>
  console.log(`Storage Server listening on port ${port}!`)
);

// ==============================================================================
