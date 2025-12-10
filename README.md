# ⚡ FydBlock – AI Algorithmic Trading Ecosystem

FydBlock is a professional, full-stack crypto trading platform featuring automated **Grid & DCA trading bots**, a high-frequency **Python execution engine**, and a **real-time portfolio tracker** with historical performance logging.

---

## 🏗️ System Architecture

The platform is structured into four synchronized microservices:

| Service | Technology | Description | Port |
|--------|------------|-------------|------|
| **Backend API** | Node.js / Express | REST API, Auth, Database & Exchange Connectivity | `5000` |
| **Trading Engine** | Python / FastAPI | High-performance bot execution & backtesting engine | `8000` |
| **User Platform** | React / Vite | Trader dashboard, portfolio & bot management | `5173` |
| **Admin Panel** | React / Vite | System management, templates & analytics | `5174` |

---

## 🚀 Key Features

- **Automated Trading:** Spot Grid & DCA bots powered by a Python engine.
- **Backtesting Simulator:** “Time-travel” simulation using historical data.
- **Real-Time Portfolio:** Live exchange balance tracking (Binance, Bybit, OKX).
- **Local Asset Icons:** Fast, offline-ready crypto logo rendering.
- **Secure Architecture:**  
  - Encrypted API keys  
  - Signed bot signals  
  - Protected backend-to-engine communication  

---

## 🛠️ Prerequisites

Install the following:

- **Node.js** (v18+)
- **Python** (v3.10+)
- **PostgreSQL** (v14+)
- **PM2** (Global)  
  ```bash
  npm install -g pm2
  ```

---

## 📦 Installation & Setup

---

## 1️⃣ Database Setup

Create the database:

```sql
CREATE DATABASE fydblock_db;
```

Run your schema files, then **add required portfolio & template tables**:

```sql
-- Portfolio History Table
CREATE TABLE portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    total_value NUMERIC(20, 2),
    assets JSONB,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System Bot Templates
INSERT INTO bots (user_id, bot_name, quote_currency, bot_type, description, status, config)
VALUES 
(1, 'Spot Grid', 'USDT', 'GRID', 'Classic buy low sell high.', 'active',
 '{"upperPrice": 60000, "lowerPrice": 30000, "gridSize": 20}'),
(1, 'Spot DCA', 'USDT', 'DCA', 'Dollar Cost Averaging.', 'active',
 '{"baseOrder": 100, "safetyOrder": 200}');
```

---

## 2️⃣ Backend API (Node.js)

```bash
cd fydblock_backend
npm install
```

Create a `.env` file:

```env
PORT=5000
DB_URL=postgres://user:pass@localhost:5432/fydblock_db
JWT_SECRET=your_jwt_secret
BOT_SECRET=my_super_secure_bot_secret_123
TRADING_ENGINE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173
```

Start server:

```bash
npm run dev
```

---

## 3️⃣ Trading Engine (Python)

```bash
cd fydblock_engine
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

Install dependencies:

```bash
pip install fastapi uvicorn ccxt pandas numpy pydantic
```

Run engine:

```bash
uvicorn bot_engine:app --host 0.0.0.0 --port 8000 --reload
```

---

## 4️⃣ User Frontend (React)

```bash
cd fydblock_user
npm install
```

Add crypto icons:

```
public/icons/
  ├── btc.svg
  ├── eth.svg
  ├── usdt.svg
  └── ...
```

Start:

```bash
npm run dev
```

---

## 🏃‍♂️ Production Deployment (PM2)

Create **ecosystem.config.js** in root:

```javascript
module.exports = {
  apps: [
    {
      name: "fyd-backend",
      script: "./fydblock_backend/server.js",
      env: { NODE_ENV: "production", PORT: 5000 }
    },
    {
      name: "fyd-engine",
      script: "uvicorn",
      args: "bot_engine:app --host 0.0.0.0 --port 8000",
      cwd: "./fydblock_engine",
      interpreter: "./fydblock_engine/venv/bin/python"
    }
  ]
};
```

Start everything:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## ❓ Troubleshooting

### 1. **Portfolio shows $0.00**
- Add API keys in *Settings*.
- Check backend logs:
  ```bash
  pm2 logs fyd-backend
  ```
- Ensure server can reach Binance/Bybit/OKX.

### 2. **Backtest chart is empty**
- Confirm Python engine is running.
- Ensure selected date range contains data.

### 3. **Python Environment Externally Managed**
- Don't install globally.  
- Always activate venv:
  ```bash
  source venv/bin/activate
  ```

---

## 📄 License

© 2025 FydBlock — All Rights Reserved.

