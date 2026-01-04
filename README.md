# FydBlock Backend

A Node.js and Express backend for FydBlock, featuring user authentication (Register/Login) with PostgreSQL.

## Features

- **RESTful API** built with Express.js  
- **Database**: PostgreSQL  
- **Authentication**: JSON Web Tokens (JWT) & bcryptjs for password hashing  
- **Security**: CORS enabled, Environment variable protection  
- **Dev Tools**: Nodemon for automatic server restarts  

## Prerequisites

Make sure the following are installed:

- Node.js (v18+ recommended)  
- PostgreSQL  

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/aashath0317/fydblock_backend.git
cd fydblock_backend
```

### 2. Install dependencies
```bash
npm install
```

## Configuration

### 1. Create a `.env` file in the project root  
### 2. Add your configuration values:

```env
PORT=5000

# Database Configuration
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fydblock_db

# Security
JWT_SECRET=your_super_secret_jwt_key
```

## Database Setup

### 1. Create the database
```sql
CREATE DATABASE fydblock_db;
```

### 2. Create the `users` table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Usage

### Development Mode
Run with Nodemon:
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

Server will run at:  
`http://localhost:5000`

## API Endpoints

### **Auth Routes**

| Method | Endpoint | Description | Body |
|--------|----------|-------------|-------|
| POST | `/api/auth/register` | Register new user | `{ "email": "user@test.com", "password": "123" }` |
| POST | `/api/auth/login` | Login & receive JWT | `{ "email": "user@test.com", "password": "123" }` |

### **System Routes**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Returns "FydBlock API is running..." |
| GET | `/test-db` | Tests database connection |

## Technologies Used

- Express.js  
- PostgreSQL (pg)  
- bcryptjs  
- JSON Web Tokens (JWT)  
- CORS  
- dotenv  
