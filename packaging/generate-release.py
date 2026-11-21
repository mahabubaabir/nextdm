#!/usr/bin/env python3
"""
Generate Release files for the APT repository.
"""
import os
import sys
import hashlib
from datetime import datetime, timezone

def generate():
    apt_dir = sys.argv[1] if len(sys.argv) > 1 else "packaging/apt"
    version = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("VERSION", "0.2.2")
    
    dists_dir = os.path.join(apt_dir, "dists/stable")
    date_str = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S UTC")
    files = ["main/binary-amd64/Packages", "main/binary-amd64/Packages.gz"]
    md5_lines, sha1_lines, sha256_lines = [], [], []

    for rel_path in files:
        full_path = os.path.join(dists_dir, rel_path)
        if os.path.exists(full_path):
            size = os.path.getsize(full_path)
            with open(full_path, "rb") as f:
                data = f.read()
            md5_lines.append(f" {hashlib.md5(data).hexdigest()} {size} {rel_path}")
            sha1_lines.append(f" {hashlib.sha1(data).hexdigest()} {size} {rel_path}")
            sha256_lines.append(f" {hashlib.sha256(data).hexdigest()} {size} {rel_path}")

    release_content = f"""Origin: NextDM
Label: NextDM Repository
Suite: stable
Codename: stable
Version: {version}
Architectures: amd64
Components: main
Description: NextDM Official APT Repository for Linux Mint & Ubuntu
Date: {date_str}
MD5Sum:
{chr(10).join(md5_lines)}
SHA1:
{chr(10).join(sha1_lines)}
SHA256:
{chr(10).join(sha256_lines)}
"""
    with open(os.path.join(dists_dir, "Release"), "w") as f:
        f.write(release_content)
    with open(os.path.join(apt_dir, "Release"), "w") as f:
        f.write(release_content)
    print(f"Generated Release files in {apt_dir} for version {version}")

if __name__ == "__main__":
    generate()
