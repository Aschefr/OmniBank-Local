use minisign::{KeyPair as KP, SecretKeyBox};
use std::{env, fs, io::Read, time::{SystemTime, UNIX_EPOCH}};

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        println!("Usage:");
        println!("  gen-tauri-keys generate           - Generate new keypair");
        println!("  gen-tauri-keys sign <file> <sk>    - Sign file with raw secret key file");
        return;
    }
    
    match args[1].as_str() {
        "generate" => generate_keys(),
        "sign" => {
            if args.len() < 4 {
                println!("Usage: gen-tauri-keys sign <file_to_sign> <secret_key_file>");
                return;
            }
            sign_file(&args[2], &args[3]);
        }
        _ => println!("Unknown command: {}", args[1]),
    }
}

fn generate_keys() {
    let kp = KP::generate_encrypted_keypair(Some("".to_string())).unwrap();
    
    let sk_box_str = kp.sk.to_box(None).unwrap().to_string();
    let pk_box_str = kp.pk.to_box().unwrap().to_string();
    
    // Save raw minisign format
    fs::write("tauri-private-key", &sk_box_str).unwrap();
    fs::write("tauri-public-key", &pk_box_str).unwrap();
    
    // Tauri CLI expects base64(entire_key_file) - save that too
    let encoded_sk = b64_encode(sk_box_str.as_bytes());
    let encoded_pk = b64_encode(pk_box_str.as_bytes());
    fs::write("tauri-private-key.b64", &encoded_sk).unwrap();
    
    let pk_line = pk_box_str.lines().nth(1).unwrap_or("");
    
    println!("=== Keys generated ===");
    println!("Raw private key:   tauri-private-key");
    println!("B64 private key:   tauri-private-key.b64  (for TAURI_SIGNING_PRIVATE_KEY env var)");
    println!("Raw public key:    tauri-public-key");
    println!();
    println!("=== For tauri.conf.json updater.pubkey ===");
    println!("{}", encoded_pk);
    println!();
    println!("=== Raw pubkey line (NOT for tauri.conf.json) ===");
    println!("{}", pk_line);
}

fn sign_file(file_path: &str, sk_path: &str) {
    let sk_str = fs::read_to_string(sk_path).expect("Cannot read secret key file");
    let sk_box = SecretKeyBox::from_string(&sk_str).expect("Invalid secret key format");
    let sk = sk_box.into_secret_key(Some("".to_string())).expect("Cannot decrypt secret key");
    
    let data_reader = fs::File::open(file_path).expect("Cannot open file");
    let buf_reader = std::io::BufReader::new(data_reader);
    
    let file_name = std::path::Path::new(file_path)
        .file_name()
        .unwrap()
        .to_string_lossy();
    
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let trusted_comment = format!("timestamp:{}\tfile:{}", timestamp, file_name);
    
    let sig_box = minisign::sign(
        None,
        &sk,
        buf_reader,
        Some(trusted_comment.as_str()),
        Some("signature from tauri secret key"),
    ).expect("Signing failed");
    
    // Write .sig file (same as Tauri does)
    let sig_path = format!("{}.sig", file_path);
    let sig_str = sig_box.to_string();
    fs::write(&sig_path, &sig_str).unwrap();
    
    println!("Signature written to: {}", sig_path);
    println!();
    println!("=== Raw signature (for latest.json) ===");
    println!("{}", sig_str.trim());
    println!();
    // Tauri CLI base64-encodes the signature for display
    let encoded_sig = b64_encode(sig_str.as_bytes());
    println!("=== Base64 signature (as Tauri CLI displays) ===");
    println!("{}", encoded_sig);
}

fn b64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = Vec::new();
    for chunk in data.chunks(3) {
        match chunk.len() {
            3 => {
                result.push(CHARS[(chunk[0] >> 2) as usize]);
                result.push(CHARS[((chunk[0] & 0x3) << 4 | chunk[1] >> 4) as usize]);
                result.push(CHARS[((chunk[1] & 0xf) << 2 | chunk[2] >> 6) as usize]);
                result.push(CHARS[(chunk[2] & 0x3f) as usize]);
            }
            2 => {
                result.push(CHARS[(chunk[0] >> 2) as usize]);
                result.push(CHARS[((chunk[0] & 0x3) << 4 | chunk[1] >> 4) as usize]);
                result.push(CHARS[((chunk[1] & 0xf) << 2) as usize]);
                result.push(b'=');
            }
            1 => {
                result.push(CHARS[(chunk[0] >> 2) as usize]);
                result.push(CHARS[((chunk[0] & 0x3) << 4) as usize]);
                result.push(b'=');
                result.push(b'=');
            }
            _ => {}
        }
    }
    String::from_utf8(result).unwrap()
}
