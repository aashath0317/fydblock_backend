# 🔥 FydBlock Backend API

The core RESTful API powering the **FydBlock Crypto Trading Platform**.  
Built with **Node.js**, **Express**, and **PostgreSQL**, this backend manages authentication, bot configuration, encrypted user API keys, and communicates with the **Python Trading Engine** to execute algorithmic trading strategies.

---

## 🏗️ System Architecture

This backend acts as the **Controller Layer** inside the FydBlock microservices ecosystem:

1. **Frontend (React)** — Interface for users to create and monitor bots  
2. **Backend API (Node.js)** — Handles authentication, database, encryption, and engine communication  
3. **Trading Engine (Python)** — Independent async engine executing Grid/DCA strategies  

---

## 🚀 Tech Stack

- **Runtime:** Node.js (v18+)  
- **Framework:** Express.js  
- **Database:** PostgreSQL + pg  
- **Authentication:** JWT + Google OAuth  
- **Crypto Library:** CCXT (balance & portfolio data)  
- **Communication:** Axios (HTTP calls to Trading Engine)  
- **Security:** AES Encryption for API Keys  

---

## 📋 Prerequisites

- Node.js **v18+**  
- PostgreSQL installed  
- Python Trading Engine running on **port 8000**  

---

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/fydblock_backend.git
cd fydblock_backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables  
Create a `.env` file in the root:

```env
PORT=5000

# Database
DB_USER=fydblock_user
DB_PASSWORD=your_db_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fydblock_db

# Security
JWT_SECRET=your_super_secret_key_change_this
ENCRYPTION_KEY=32_char_hex_string_for_api_keys

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Python Engine URL
TRADING_ENGINE_URL=http://localhost:8000
```

### 4. Database Setup
```bash
psql -U postgres -d fydblock_db -f database.sql
```

---

## 🏃‍♂️ Running the Server

### Development Mode (Auto Reload)
```bash
npm run dev
```

### Production Mode (PM2)
```bash
npm install -g pm2
pm2 start server.js --name "fydblock-api"
pm2 save
```

---

## 📡 API Endpoints

### 🔐 Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |
| POST | `/api/auth/google` | Login via Google OAuth |

---

### 👤 User & Bots
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/me` | Fetch authenticated user |
| POST | `/api/user/exchange` | Save encrypted API keys |
| POST | `/api/user/bot` | Create bot (Triggers Python `/start`) |
| GET | `/api/user/bots` | List user's bots |
| PUT | `/api/user/bot/:id` | Update bot configuration |
| DELETE | `/api/user/bot/:id` | Stop bot (Python `/stop`) and delete |

---

### 🛠️ Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/bots` | Manage system bot templates |
| GET | `/api/admin/users` | View all registered users |

---

## 🤝 Integration Flow

### When a user creates a bot:

1. Frontend sends configuration → Backend  
2. Backend saves bot in PostgreSQL  
3. Backend decrypts user’s API keys internally  
4. Backend sends `POST /start` → Python Trading Engine  
5. Trading Engine launches async Grid/DCA loop  
6. Bot begins live trading  

---

## 📄 License

**MIT License**
