#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Val, Vec};

#[contracttype]
#[derive(Clone)]
pub struct NodeBlueprint {
    pub wasm_hash: BytesN<32>,
    pub salt: BytesN<32>,
    pub constructor_args: Vec<Val>,
}

#[contract]
pub struct PipelineFactory;

#[contractimpl]
impl PipelineFactory {
    /// Deploy a pipeline of contracts on behalf of `source`.
    ///
    /// Each node is deployed deterministically using `source + salt` as the
    /// contract ID preimage, preserving the same address derivation used by
    /// the JS `computeContractAddress` helper.
    ///
    /// `source` must authorize this call.
    pub fn deploy_pipeline(env: Env, source: Address, nodes: Vec<NodeBlueprint>) -> Vec<Address> {
        source.require_auth();

        let mut addresses = Vec::new(&env);
        for node in nodes.iter() {
            let deployer = env
                .deployer()
                .with_address(source.clone(), node.salt.clone());
            let address = deployer.deploy_v2(node.wasm_hash.clone(), node.constructor_args.clone());
            addresses.push_back(address);
        }
        addresses
    }
}
