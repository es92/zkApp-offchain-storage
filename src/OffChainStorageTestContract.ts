import {
  SmartContract,
  Field,
  Experimental,
  state,
  State,
  method,
  DeployArgs,
  Signature,
  PublicKey,
  Permissions,
  Bool,
} from 'snarkyjs';

import { assertRootUpdateValid } from './offChainStorage.js';

class MerkleWitness extends Experimental.MerkleWitness(8) {}

export class OffChainStorageTestContract extends SmartContract {
  @state(Field) root = State<Field>();
  @state(Field) rootNumber = State<Field>();
  @state(PublicKey) serverPublicKey = State<PublicKey>();

  // TODO should I be doing my init things inside deploy? does that assert them?
  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method init(serverPublicKey: PublicKey) {
    const tree = new Experimental.MerkleTree(4); // TODO what is the right way to set this dynamically?
    const root = tree.getRoot();
    root.assertEquals(root); // is this really the right way to ensure the init is an empty tree?
    this.root.set(root);

    const rootNumber = Field.fromNumber(0);
    rootNumber.assertEquals(rootNumber); // is this really right?
    this.rootNumber.set(rootNumber);

    this.serverPublicKey.set(serverPublicKey);
  }

  @method update(
    leafIsEmpty: Bool,
    oldNum: Field,
    num: Field,
    path: MerkleWitness,
    storedNewRoot: Field,
    storedNewRootNumber: Field,
    storedNewRootSignature: Signature
  ) {
    let root = this.root.get();
    this.root.assertEquals(root);

    let rootNumber = this.rootNumber.get();
    this.rootNumber.assertEquals(rootNumber);

    let serverPublicKey = this.serverPublicKey.get();
    this.serverPublicKey.assertEquals(serverPublicKey);

    let leaf = [oldNum];
    let newLeaf = [num];

    // newLeaf can be a function of the existing leaf
    newLeaf[0].assertGt(leaf[0]);

    assertRootUpdateValid(
      serverPublicKey,
      root,
      rootNumber,
      leaf,
      leafIsEmpty,
      path,
      newLeaf,
      storedNewRoot,
      storedNewRootNumber,
      storedNewRootSignature
    );

    this.root.set(storedNewRoot);
    this.rootNumber.set(storedNewRootNumber);
  }
}
