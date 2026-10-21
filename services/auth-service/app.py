from flask import Flask, jsonify
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

@app.route('/api/auth/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "auth-service"}), 200

if __name__ == '__main__':
    port = int(os.getenv("SERVICE_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=True)