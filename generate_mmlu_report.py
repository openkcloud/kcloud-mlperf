#!/usr/bin/env python3
"""
Generate HTML report from MMLU evaluation results
"""
import json
import argparse
import os
from datetime import datetime

def generate_html_report(results, output_path):
    """Generate an HTML report from MMLU results"""
    
    # Extract data
    model = results.get('model', 'Unknown')
    dataset = results.get('dataset', 'MMLU')
    overall_accuracy = results.get('overall_accuracy', 0)
    overall_correct = results.get('overall_correct', 0)
    overall_total = results.get('overall_total', 0)
    eval_time = results.get('evaluation_time', 0)
    samples_per_sec = results.get('samples_per_second', 0)
    subjects = results.get('subjects', {})
    
    # Generate HTML
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>MMLU Evaluation Results - {model}</title>
    <style>
        body {{ 
            font-family: Arial, sans-serif; 
            margin: 40px; 
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .header {{ 
            background: #1e3a8a; 
            color: white; 
            padding: 30px; 
            border-radius: 8px; 
            margin-bottom: 30px;
        }}
        .header h1 {{
            margin: 0 0 10px 0;
            font-size: 32px;
        }}
        .header p {{
            margin: 5px 0;
            font-size: 18px;
        }}
        .metrics {{ 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 20px; 
            margin: 30px 0; 
        }}
        .metric {{ 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px; 
            border-left: 4px solid #3b82f6; 
            text-align: center;
        }}
        .metric h3 {{ 
            margin: 0 0 15px 0; 
            color: #1e3a8a; 
            font-size: 18px;
        }}
        .metric .value {{ 
            font-size: 36px; 
            font-weight: bold; 
            color: #059669; 
        }}
        .metric .subtitle {{
            font-size: 14px;
            color: #6b7280;
            margin-top: 5px;
        }}
        .subjects {{
            margin: 30px 0;
        }}
        .subjects h2 {{
            color: #1e3a8a;
            margin-bottom: 20px;
        }}
        .subject-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 15px;
        }}
        .subject-card {{
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 15px;
        }}
        .subject-card h3 {{
            margin: 0 0 10px 0;
            color: #374151;
            font-size: 16px;
        }}
        .subject-card .accuracy {{
            font-size: 24px;
            font-weight: bold;
            color: #059669;
        }}
        .subject-card .samples {{
            font-size: 14px;
            color: #6b7280;
        }}
        .examples {{
            margin: 30px 0;
        }}
        .examples h2 {{
            color: #1e3a8a;
            margin-bottom: 20px;
        }}
        .example {{
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
        }}
        .example.correct {{
            border-left: 4px solid #059669;
        }}
        .example.incorrect {{
            border-left: 4px solid #dc2626;
        }}
        .example h4 {{
            margin: 0 0 10px 0;
            color: #374151;
        }}
        .example .question {{
            font-weight: bold;
            margin-bottom: 10px;
        }}
        .example .choices {{
            margin: 10px 0;
        }}
        .example .choice {{
            margin: 5px 0;
            padding: 5px 10px;
            background: white;
            border-radius: 4px;
        }}
        .example .choice.correct {{
            background: #d1fae5;
            font-weight: bold;
        }}
        .example .choice.predicted {{
            border: 2px solid #3b82f6;
        }}
        .example .result {{
            margin-top: 10px;
            font-style: italic;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 MMLU Evaluation Results</h1>
            <p><strong>Model:</strong> {model}</p>
            <p><strong>Dataset:</strong> {dataset}</p>
            <p><strong>Timestamp:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        </div>
        
        <div class="metrics">
            <div class="metric">
                <h3>🎯 Overall Accuracy</h3>
                <div class="value">{overall_accuracy:.1%}</div>
                <div class="subtitle">{overall_correct} / {overall_total} correct</div>
            </div>
            <div class="metric">
                <h3>📝 Total Questions</h3>
                <div class="value">{overall_total:,}</div>
                <div class="subtitle">Questions evaluated</div>
            </div>
            <div class="metric">
                <h3>⏱️ Evaluation Time</h3>
                <div class="value">{eval_time/60:.1f}m</div>
                <div class="subtitle">{eval_time:.0f} seconds</div>
            </div>
            <div class="metric">
                <h3>⚡ Speed</h3>
                <div class="value">{samples_per_sec:.2f}</div>
                <div class="subtitle">Questions per second</div>
            </div>
        </div>
"""
    
    # Add subject results if available
    if subjects:
        html_content += """
        <div class="subjects">
            <h2>📚 Results by Subject</h2>
            <div class="subject-grid">
"""
        for subject, data in subjects.items():
            accuracy = data.get('accuracy', 0)
            correct = data.get('correct', 0)
            total = data.get('total', 0)
            
            html_content += f"""
                <div class="subject-card">
                    <h3>{subject.replace('_', ' ').title()}</h3>
                    <div class="accuracy">{accuracy:.1%}</div>
                    <div class="samples">{correct}/{total} correct</div>
                </div>
"""
        
        html_content += """
            </div>
        </div>
"""
    
    # Add example predictions if available
    if subjects and any('predictions' in data for data in subjects.values()):
        html_content += """
        <div class="examples">
            <h2>📋 Example Predictions</h2>
"""
        
        # Get first few predictions from each subject
        example_count = 0
        for subject, data in subjects.items():
            if 'predictions' in data and example_count < 5:
                for pred in data['predictions'][:2]:  # Max 2 per subject
                    if example_count >= 5:
                        break
                    
                    question = pred.get('question', '')
                    choices = pred.get('choices', [])
                    correct_answer = pred.get('correct_answer', -1)
                    predicted_answer = pred.get('predicted_answer', -1)
                    generated_text = pred.get('generated_text', '')
                    is_correct = pred.get('correct', False)
                    
                    html_content += f"""
            <div class="example {'correct' if is_correct else 'incorrect'}">
                <h4>{'✅ Correct' if is_correct else '❌ Incorrect'} - {subject.replace('_', ' ').title()}</h4>
                <div class="question">Question: {question}</div>
                <div class="choices">
"""
                    for i, choice in enumerate(choices):
                        letter = chr(65 + i)
                        classes = ['choice']
                        if i == correct_answer:
                            classes.append('correct')
                        if i == predicted_answer:
                            classes.append('predicted')
                        
                        html_content += f"""
                    <div class="{' '.join(classes)}">{letter}. {choice}</div>
"""
                    
                    html_content += f"""
                </div>
                <div class="result">
                    Model generated: "{generated_text}"<br>
                    Correct answer: {chr(65 + correct_answer) if correct_answer >= 0 else 'N/A'}, 
                    Predicted: {chr(65 + predicted_answer) if predicted_answer >= 0 else 'Invalid'}
                </div>
            </div>
"""
                    example_count += 1
        
        html_content += """
        </div>
"""
    
    # Add footer
    html_content += """
        <div class="footer">
            <p>Generated by MMLU Evaluation Report Generator</p>
            <p>LLaMA 3.1 8B on MMLU Benchmark</p>
        </div>
    </div>
</body>
</html>
"""
    
    # Write HTML file
    with open(output_path, 'w') as f:
        f.write(html_content)
    
    print(f"📋 HTML report generated: {output_path}")

def main():
    parser = argparse.ArgumentParser(description='Generate MMLU evaluation report')
    parser.add_argument('input', help='Input JSON file with MMLU results')
    parser.add_argument('output', help='Output HTML report path')
    args = parser.parse_args()
    
    # Read results
    with open(args.input, 'r') as f:
        results = json.load(f)
    
    # Generate report
    generate_html_report(results, args.output)

if __name__ == '__main__':
    main()