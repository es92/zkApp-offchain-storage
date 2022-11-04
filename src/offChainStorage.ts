import {
  Poseidon,
  Field,
  Bool,
  Experimental,
  Signature,
  PublicKey,
  Circuit,
} from 'snarkyjs';

export class MerkleWitness8 extends Experimental.MerkleWitness(8) {}

// ==============================================================================

const printCaution = () =>
  console.log(
    'CAUTION: This project is in development and not to be relied upon to guarantee storage in production environments.'
  );

export type Update = {
  leaf: Field[];
  leafIsEmpty: Bool;
  newLeaf: Field[];
  newLeafIsEmpty: Bool;
  leafWitness: MerkleWitness8;
};

export const assertRootUpdateValid = (
  serverPublicKey: PublicKey,
  rootNumber: Field,
  root: Field,
  updates: Update[],
  storedNewRootNumber: Field,
  storedNewRootSignature: Signature
) => {
  let emptyLeaf = Field.fromNumber(0);

  var currentRoot = root;
  for (var i = 0; i < updates.length; i++) {
    const { leaf, leafIsEmpty, newLeaf, newLeafIsEmpty, leafWitness } =
      updates[i];

    // check the root is starting from the correct state
    let leafHash = Circuit.if(leafIsEmpty, emptyLeaf, Poseidon.hash(leaf));
    leafWitness.calculateRoot(leafHash).assertEquals(currentRoot);

    // calculate the new root after setting the leaf
    let newLeafHash = Circuit.if(
      newLeafIsEmpty,
      emptyLeaf,
      Poseidon.hash(newLeaf)
    );
    currentRoot = leafWitness.calculateRoot(newLeafHash);
  }

  const storedNewRoot = currentRoot;

  // check the server is storing the stored new root
  storedNewRootSignature
    .verify(serverPublicKey, [storedNewRoot, storedNewRootNumber])
    .assertTrue();
  rootNumber.assertLt(storedNewRootNumber);

  return storedNewRoot;
};

// ==============================================================================

export const get = async (
  serverAddress: string,
  zkAppAddress: PublicKey,
  height: number,
  root: Field,
  UserXMLHttpRequest: typeof XMLHttpRequest | null = null
) => {
  const idx2fields = new Map<number, Field[]>();

  const tree = new Experimental.MerkleTree(height);
  if (tree.getRoot().equals(root).toBoolean()) {
    return idx2fields;
  }

  var params =
    'zkAppAddress=' + zkAppAddress.toBase58() + '&root=' + root.toString();

  const response = await makeRequest(
    'GET',
    serverAddress + '/data?' + params,
    null,
    UserXMLHttpRequest
  );

  const data = JSON.parse(response);
  printCaution();

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

export const requestStore = async (
  serverAddress: string,
  zkAppAddress: PublicKey,
  height: number,
  idx2fields: Map<number, Field[]>,
  UserXMLHttpRequest: typeof XMLHttpRequest | null = null
): Promise<[Field, Signature]> => {
  const items = [];

  for (let [idx, fields] of idx2fields) {
    items.push([idx, fields.map((f) => f.toString())]);
  }

  const response = await makeRequest(
    'POST',
    serverAddress + '/data',
    JSON.stringify({
      zkAppAddress: zkAppAddress.toBase58(),
      items,
      height,
    }),
    UserXMLHttpRequest
  );

  const data = JSON.parse(response);
  printCaution();

  const result: [string, string[]] = data.result;

  const newRootNumber = Field.fromString(result[0]);
  const newRootSignature = Signature.ofFields(
    result[1].map((s) => Field.fromString(s))
  );
  return [newRootNumber, newRootSignature];
};

// ==============================================================================

export const getPublicKey = async (
  serverAddress: string,
  UserXMLHttpRequest: typeof XMLHttpRequest | null = null
) => {
  const response = await makeRequest(
    'GET',
    serverAddress + '/publicKey',
    null,
    UserXMLHttpRequest
  );

  const data = JSON.parse(response);
  printCaution();

  const publicKey = PublicKey.fromBase58(data.serverPublicKey58);

  return publicKey;
};

// ==============================================================================

export function makeRequest(
  method: string,
  url: string,
  data: string | null = null,
  UserXMLHttpRequest: typeof XMLHttpRequest | null = null
): Promise<string> {
  return new Promise(function (resolve, reject) {
    let xhr: XMLHttpRequest;
    if (UserXMLHttpRequest != null) {
      xhr = new UserXMLHttpRequest();
    } else {
      xhr = new XMLHttpRequest();
    }
    xhr.open(method, url);
    xhr.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject({
          status: this.status,
          statusText: xhr.responseText,
        });
      }
    };
    xhr.onerror = function () {
      reject({
        status: this.status,
        statusText: xhr.responseText,
      });
    };
    if (data != null) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    }
    xhr.send(data);
  });
}

// ==============================================================================

export function mapToTree(height: number, idx2fields: Map<number, Field[]>) {
  const tree = new Experimental.MerkleTree(height);
  for (let [k, fields] of idx2fields) {
    tree.setLeaf(BigInt(k), Poseidon.hash(fields));
  }
  return tree;
}

// ==============================================================================
