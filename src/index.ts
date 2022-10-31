import {
  MerkleWitness8,
  Update,
  assertRootUpdateValid,
  get,
  requestStore,
  getPublicKey,
  makeRequest,
  mapToTree,
} from './offChainStorage.js';

export type { Update };

const OffChainStorage = {
  assertRootUpdateValid,
  get,
  requestStore,
  getPublicKey,
  makeRequest,
  mapToTree,
};

export { OffChainStorage, MerkleWitness8 };
