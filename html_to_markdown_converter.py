#!/usr/bin/env python3
"""
HTML to Markdown Converter for MLPerf Benchmark Reports

This script converts HTML benchmark reports to clean Markdown format,
preserving all metrics, tables, and formatting.
"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime
from html.parser import HTMLParser
from typing import List, Dict, Any, Optional


class HTMLToMarkdownConverter(HTMLParser):
    """Custom HTML parser to convert HTML to Markdown"""
    
    def __init__(self):
        super().__init__()
        self.markdown_lines = []
        self.current_text = []
        self.in_style = False
        self.in_script = False
        self.in_table = False
        self.in_table_row = False
        self.table_headers = []
        self.table_rows = []
        self.current_row = []
        self.tag_stack = []
        self.list_level = 0
        self.in_code = False
        
    def handle_starttag(self, tag: str, attrs: List[tuple]):
        self.tag_stack.append(tag)
        
        # Store attributes for context
        self.current_attrs = dict(attrs) if attrs else {}
        
        if tag == 'style':
            self.in_style = True
        elif tag == 'script':
            self.in_script = True
        elif tag == 'h1':
            self._flush_text()
            self.current_text.append('\n# ')
        elif tag == 'h2':
            self._flush_text()
            self.current_text.append('\n## ')
        elif tag == 'h3':
            self._flush_text()
            self.current_text.append('\n### ')
        elif tag == 'h4':
            self._flush_text()
            self.current_text.append('\n#### ')
        elif tag == 'p':
            self._flush_text()
            self.current_text.append('\n')
        elif tag == 'br':
            self.current_text.append('  \n')
        elif tag == 'strong' or tag == 'b':
            self.current_text.append('**')
        elif tag == 'em' or tag == 'i':
            self.current_text.append('*')
        elif tag == 'code':
            self.current_text.append('`')
            self.in_code = True
        elif tag == 'pre':
            self._flush_text()
            self.current_text.append('\n```\n')
        elif tag == 'ul':
            self._flush_text()
            self.list_level += 1
        elif tag == 'ol':
            self._flush_text()
            self.list_level += 1
        elif tag == 'li':
            self._flush_text()
            indent = '  ' * (self.list_level - 1)
            self.current_text.append(f'\n{indent}- ')
        elif tag == 'table':
            self._flush_text()
            self.in_table = True
            self.table_headers = []
            self.table_rows = []
        elif tag == 'tr':
            if self.in_table:
                self.in_table_row = True
                self.current_row = []
        elif tag in ['th', 'td']:
            pass
        elif tag == 'div':
            # Check for special div classes
            for attr_name, attr_value in attrs:
                if attr_name == 'class':
                    if 'metric-card' in attr_value:
                        self._flush_text()
                        self.current_text.append('\n### ')
                    elif 'metric-value' in attr_value:
                        self.current_text.append('**')
                    elif 'metric-label' in attr_value or 'metric-subtitle' in attr_value:
                        self.current_text.append('\n')
                    elif 'highlight' in attr_value:
                        self.current_text.append('**')
                    elif 'success' in attr_value:
                        self.current_text.append('✅ ')
                    elif 'sample-box' in attr_value:
                        self._flush_text()
                        self.current_text.append('\n#### ')
                    elif 'sample-title' in attr_value:
                        self.current_text.append('**')
                        
    def handle_endtag(self, tag: str):
        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()
            
        if tag == 'style':
            self.in_style = False
        elif tag == 'script':
            self.in_script = False
        elif tag in ['h1', 'h2', 'h3', 'h4']:
            self._flush_text()
            self.markdown_lines.append('\n')
        elif tag == 'p':
            self._flush_text()
            self.markdown_lines.append('\n')
        elif tag == 'strong' or tag == 'b':
            self.current_text.append('**')
        elif tag == 'em' or tag == 'i':
            self.current_text.append('*')
        elif tag == 'code':
            self.current_text.append('`')
            self.in_code = False
        elif tag == 'pre':
            self.current_text.append('\n```\n')
        elif tag == 'ul' or tag == 'ol':
            self.list_level -= 1
        elif tag == 'table':
            self._flush_text()
            self._render_table()
            self.in_table = False
        elif tag == 'tr':
            if self.in_table_row:
                if self.table_headers == [] and self.current_row:
                    self.table_headers = self.current_row
                elif self.current_row:
                    self.table_rows.append(self.current_row)
                self.in_table_row = False
        elif tag == 'th' or tag == 'td':
            if self.in_table_row:
                cell_text = ''.join(self.current_text).strip()
                self.current_row.append(cell_text)
                self.current_text = []
        elif tag == 'div':
            # Check if we need to close special formatting based on class
            if hasattr(self, 'current_attrs') and 'class' in self.current_attrs:
                class_value = self.current_attrs.get('class', '')
                if 'metric-value' in class_value or 'highlight' in class_value or 'sample-title' in class_value:
                    self.current_text.append('**')
                elif 'metric-card' in class_value or 'sample-box' in class_value:
                    self._flush_text()
                    self.markdown_lines.append('\n')
                            
    def handle_data(self, data: str):
        if not self.in_style and not self.in_script:
            # Clean up whitespace but preserve necessary spaces
            if self.in_code:
                self.current_text.append(data)
            else:
                cleaned_data = ' '.join(data.split())
                if cleaned_data:
                    self.current_text.append(cleaned_data)
                    
    def _flush_text(self):
        if self.current_text:
            text = ' '.join(self.current_text)
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                self.markdown_lines.append(text)
            self.current_text = []
            
    def _render_table(self):
        if not self.table_headers:
            return
            
        # Create table header
        self.markdown_lines.append('\n')
        self.markdown_lines.append('| ' + ' | '.join(self.table_headers) + ' |')
        self.markdown_lines.append('|' + '---|' * len(self.table_headers))
        
        # Add table rows
        for row in self.table_rows:
            # Ensure row has same number of columns as headers
            while len(row) < len(self.table_headers):
                row.append('')
            self.markdown_lines.append('| ' + ' | '.join(row[:len(self.table_headers)]) + ' |')
            
        self.markdown_lines.append('\n')
        
    def get_markdown(self) -> str:
        self._flush_text()
        # Clean up the output
        markdown = '\n'.join(self.markdown_lines)
        
        # Remove excessive newlines
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)
        
        # Fix list formatting
        markdown = re.sub(r'\n\s*-\s+', '\n- ', markdown)
        
        # Ensure proper spacing around headers
        markdown = re.sub(r'(#{1,6}\s+[^\n]+)\n(?!\n)', r'\1\n\n', markdown)
        
        # Fix metric formatting (ensure line breaks between metric components)
        markdown = re.sub(r'(\*\*[^*]+\*\*)\s+([A-Za-z])', r'\1  \n\2', markdown)
        
        # Clean up spacing issues
        markdown = re.sub(r' +', ' ', markdown)
        markdown = re.sub(r'\n +', '\n', markdown)
        
        # Ensure tables are properly formatted
        markdown = re.sub(r'\|\s+', '| ', markdown)
        markdown = re.sub(r'\s+\|', ' |', markdown)
        
        return markdown.strip()


def convert_html_to_markdown(html_content: str) -> str:
    """Convert HTML content to Markdown format"""
    converter = HTMLToMarkdownConverter()
    converter.feed(html_content)
    return converter.get_markdown()


def extract_metrics_from_script(html_content: str) -> Optional[Dict[str, Any]]:
    """Extract metrics data from JavaScript sections if present"""
    script_pattern = r'<script[^>]*>(.*?)</script>'
    scripts = re.findall(script_pattern, html_content, re.DOTALL)
    
    metrics = {}
    for script in scripts:
        # Look for scenario data
        if 'scenarios' in script:
            scenario_pattern = r"\{name:\s*'([^']+)',\s*samples:\s*(\d+),\s*description:\s*'([^']+)'\}"
            scenarios = re.findall(scenario_pattern, script)
            if scenarios:
                metrics['scenarios'] = [
                    {'name': s[0], 'samples': int(s[1]), 'description': s[2]}
                    for s in scenarios
                ]
                
    return metrics if metrics else None


def process_html_file(html_path: Path) -> bool:
    """Process a single HTML file and convert it to Markdown"""
    try:
        # Read HTML content
        with open(html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
            
        # Convert to Markdown
        markdown_content = convert_html_to_markdown(html_content)
        
        # Extract any additional metrics from scripts
        script_metrics = extract_metrics_from_script(html_content)
        
        # Add script metrics to markdown if found
        if script_metrics and 'scenarios' in script_metrics:
            markdown_content += '\n\n## Scenario Details\n\n'
            for scenario in script_metrics['scenarios']:
                markdown_content += f"### {scenario['name']}\n"
                markdown_content += f"- **Samples**: {scenario['samples']}\n"
                markdown_content += f"- **Description**: {scenario['description']}\n\n"
                
        # Generate output path
        output_path = html_path.with_suffix('.md')
        
        # Write Markdown file
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(markdown_content)
            
        print(f"✅ Converted: {html_path} -> {output_path}")
        return True
        
    except Exception as e:
        print(f"❌ Error converting {html_path}: {str(e)}")
        return False


def find_html_reports(base_dir: Path = Path('.')) -> List[Path]:
    """Find all HTML report files in results directories"""
    html_files = []
    
    # Common patterns for report files
    patterns = [
        '**/results*/**/*.html',
        '**/report*/**/*.html',
        '**/*report*.html',
        '**/*results*.html'
    ]
    
    for pattern in patterns:
        html_files.extend(base_dir.glob(pattern))
        
    # Remove duplicates and sort
    html_files = sorted(set(html_files))
    
    return html_files


def main():
    """Main function to convert all HTML reports to Markdown"""
    print("🔍 HTML to Markdown Converter for MLPerf Benchmark Reports")
    print("=" * 60)
    
    # Find all HTML report files
    base_dir = Path('.')
    html_files = find_html_reports(base_dir)
    
    if not html_files:
        print("❌ No HTML report files found in results directories")
        return
        
    print(f"\n📊 Found {len(html_files)} HTML report files to convert:\n")
    
    for i, html_file in enumerate(html_files, 1):
        print(f"{i}. {html_file}")
        
    print(f"\n🚀 Starting conversion...\n")
    
    # Process each file
    success_count = 0
    for html_file in html_files:
        if process_html_file(html_file):
            success_count += 1
            
    # Summary
    print("\n" + "=" * 60)
    print(f"✅ Conversion complete!")
    print(f"📊 Successfully converted: {success_count}/{len(html_files)} files")
    
    if success_count < len(html_files):
        print(f"⚠️  Failed conversions: {len(html_files) - success_count}")


if __name__ == "__main__":
    main()