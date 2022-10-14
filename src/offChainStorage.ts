import {
  Poseidon,
  Field,
  Bool,
  Experimental,
  Signature,
  PublicKey,
  Circuit,
} from 'snarkyjs';

import { XMLHttpRequest } from 'xmlhttprequest-ts';

class MerkleWitness extends Experimental.MerkleWitness(8) {}

// ==============================================================================

type Update = {
  root: Field;

  leaf: Field[];
  leafIsEmpty: Bool;

  newLeaf: Field[];
  newLeafIsEmpty: Bool;

  leafWitness: MerkleWitness;
};

export const assertRootUpdateValid = (
  serverPublicKey: PublicKey,
  rootNumber: Field,
  updates: Update[],
  storedNewRoot: Field,
  storedNewRootNumber: Field,
  storedNewRootSignature: Signature
) => {
  let empty_leaf = Field.fromNumber(0);

  var currentRoot = updates[0].root;
  for (var i = 0; i < updates.length; i++) {
    const { root, leaf, leafIsEmpty, newLeaf, newLeafIsEmpty, leafWitness } =
      updates[i];
    currentRoot.assertEquals(root);

    // check the root is starting from the correct state
    let leafHash = Circuit.if(leafIsEmpty, empty_leaf, Poseidon.hash(leaf));
    leafWitness.calculateRoot(leafHash).assertEquals(root);

    // calculate the new root after setting the leaf
    let newLeafHash = Circuit.if(
      newLeafIsEmpty,
      empty_leaf,
      Poseidon.hash(newLeaf)
    );
    currentRoot = leafWitness.calculateRoot(newLeafHash);
  }

  // check the new root is the one that the server has stored
  currentRoot.assertEquals(storedNewRoot);

  // check the server is storing the stored new root
  storedNewRootSignature
    .verify(serverPublicKey, [storedNewRoot, storedNewRootNumber])
    .assertTrue();
  rootNumber.assertLt(storedNewRootNumber);
};

// ==============================================================================

export const get = (
  serverAddress: string,
  zkAppAddress: PublicKey,
  height: number,
  root: Field
) => {
  const idx2fields = new Map<number, Field[]>();

  const tree = new Experimental.MerkleTree(height);
  if (tree.getRoot().equals(root).toBoolean()) {
    return idx2fields;
  }

  const xhttp = new XMLHttpRequest();

  var params =
    'zkAppAddress=' + zkAppAddress.toBase58() + '&root=' + root.toString();

  xhttp.open('GET', serverAddress + '/data?' + params, false);
  xhttp.send();

  const data = JSON.parse(xhttp.responseText);
  if (data.unaudited) {
    console.log(
      'WARNING: SERVER IS A REFERENCE IMPLEMENTATION AND UNAUDITED. TO NOT BE USED IN PRODUCTION'
    );
  }

  const items: Array<[number, string[]]> = data.items;
  const fieldItems: Array<[number, Field[]]> = items.map(([idx, strs]) => [
    idx,
    strs.map((s) => Field.fromString(s)),
  ]);

  fieldItems.forEach(([index, fields]) => {
    idx2fields.set(index, fields);
  });

  return idx2fields;
};

// ==============================================================================

export const request_store = (
  serverAddress: string,
  zkAppAddress: PublicKey,
  height: number,
  idx2fields: Map<number, Field[]>
): [Field, Signature] => {
  const xhttp = new XMLHttpRequest();

  const items = [];

  for (let [idx, fields] of idx2fields) {
    items.push([idx, fields.map((f) => f.toString())]);
  }

  xhttp.open('POST', serverAddress + '/data', false);
  xhttp.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
  xhttp.send(
    JSON.stringify({
      zkAppAddress: zkAppAddress.toBase58(),
      items,
      height,
    })
  );

  const data = JSON.parse(xhttp.responseText);
  if (data.unaudited) {
    console.log(
      'WARNING: SERVER IS A REFERENCE IMPLEMENTATION AND UNAUDITED. TO NOT BE USED IN PRODUCTION'
    );
  }

  const result: [string, string[]] = data.result;

  const newRootNumber = Field.fromString(result[0]);
  const newRootSignature = Signature.ofFields(
    result[1].map((s) => Field.fromString(s))
  );
  return [newRootNumber, newRootSignature];
};

// ==============================================================================

export const get_public_key = (serverAddress: string) => {
  const xhttp = new XMLHttpRequest();

  xhttp.open('GET', serverAddress + '/public_key', false);
  xhttp.send();

  const data = JSON.parse(xhttp.responseText);
  if (data.unaudited) {
    console.log(
      'WARNING: SERVER IS A REFERENCE IMPLEMENTATION AND UNAUDITED. TO NOT BE USED IN PRODUCTION'
    );
  }

  const publicKey = PublicKey.fromBase58(data.serverPublicKey58);

  return publicKey;
};

// ==============================================================================

export default { get_public_key, get, request_store, assertRootUpdateValid };
