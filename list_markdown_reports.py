#!/usr/bin/env python3
"""
List all converted Markdown reports
"""

import os
from pathlib import Path

def list_markdown_reports():
    """Find and list all Markdown report files"""
    print("📋 Converted Markdown Reports:")
    print("=" * 60)
    
    markdown_files = []
    patterns = ['**/*report*.md', '**/results*/**/*.md']
    
    for pattern in patterns:
        markdown_files.extend(Path('.').glob(pattern))
    
    # Remove duplicates and sort
    markdown_files = sorted(set(markdown_files))
    
    if not markdown_files:
        print("❌ No Markdown report files found")
        return
    
    for md_file in markdown_files:
        # Get file size
        size = os.path.getsize(md_file)
        size_kb = size / 1024
        
        print(f"\n📄 {md_file}")
        print(f"   Size: {size_kb:.1f} KB")
        
        # Read first few lines to show title
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()[:5]
                for line in lines:
                    if line.strip() and line.startswith('#'):
                        print(f"   Title: {line.strip()}")
                        break
        except:
            pass
    
    print(f"\n✅ Total Markdown reports: {len(markdown_files)}")

if __name__ == "__main__":
    list_markdown_reports()