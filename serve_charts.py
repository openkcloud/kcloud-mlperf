#!/usr/bin/env python3
"""
Simple HTTP server to view MLPerf benchmark charts
"""
import http.server
import socketserver
import os
import webbrowser

# Change to reports directory
os.chdir('reports')

PORT = 8080

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add headers to allow viewing in browser
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

print(f"🌐 Starting web server on port {PORT}")
print(f"📊 View your charts at: http://localhost:{PORT}/view_charts.html")
print(f"   or directly at: http://$(hostname -I | awk '{print $1}'):{PORT}/view_charts.html")
print(f"\n🛑 Press Ctrl+C to stop the server\n")

with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n✅ Server stopped.")