fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto = "../../contracts/proto/check_perm.proto";
    let proto_dir = "../../contracts/proto";
    tonic_build::configure()
        .build_server(false)
        .build_client(true)
        .compile(&[proto], &[proto_dir])?;
    println!("cargo:rerun-if-changed={}", proto);
    Ok(())
}
