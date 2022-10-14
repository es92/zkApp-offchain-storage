//const cors = require('cors');
import express from 'express';

import {
  isReady,
  PrivateKey,
  Field,
  Experimental,
  Poseidon,
  Signature,
} from 'snarkyjs';

await isReady;

// TODO save this persistently
const serverPrivateKey = PrivateKey.random();
const serverPublicKey = serverPrivateKey.toPublicKey();

const app = express();
const port = 3001;

app.use(express.json());

// ==============================================================================

// TODO switch to something persistent
type data_obj_map = {
  [root: string]: { rootNumber: BigInt; items: Array<[number, string[]]> };
};
const database: {
  [zkAppAddress: string]: { nextNumber: number; root2data: data_obj_map };
} = {};

// ==============================================================================

(async () => {
  for (;;) {
    for (let zkAppAddress in database) {
      // fetch the account and its root number. root number must be stored in slot 1!
      let accountRootNumber = BigInt(0);
      var root2data = database[zkAppAddress].root2data;
      database[zkAppAddress].root2data = {};
      for (let root in root2data) {
        if (root2data[root].rootNumber >= accountRootNumber) {
          database[zkAppAddress].root2data[root] = root2data[root];
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
})();

// TODO add cleanup

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

  if (!(zkAppAddress58 in database)) {
    database[zkAppAddress58] = {
      nextNumber: 1,
      root2data: {},
    };
  }

  const newRoot = tree.getRoot();
  const newRootNumber = Field.fromNumber(database[zkAppAddress58].nextNumber);

  database[zkAppAddress58].nextNumber += 1;
  database[zkAppAddress58].root2data[newRoot.toString()] = {
    rootNumber: newRootNumber.toBigInt(),
    items,
  };

  let newRootSignature = Signature.create(serverPrivateKey, [
    newRoot,
    newRootNumber,
  ]);

  res.json([
    newRootNumber.toString(),
    newRootSignature.toFields().map((f) => f.toString()),
  ]);
});

// ==============================================================================

app.get('/data', (req, res) => {
  const zkAppAddress58: string = req.body.zkAppAddress;
  const root: string = req.body.root;

  res.json(database[zkAppAddress58].root2data[root]);
});

// ==============================================================================

app.get('/public_key', (req, res) => {
  res.send(serverPublicKey.toBase58());
});

// ==============================================================================

app.listen(port, () =>
  console.log(`Storage Server listening on port ${port}!`)
);
