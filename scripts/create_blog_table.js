const pool = require('../db');

const createBlogTable = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS blogs (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            excerpt TEXT,
            content TEXT NOT NULL,
            category VARCHAR(100),
            author VARCHAR(100),
            image_url TEXT,
            read_time VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await pool.query(query);
        console.log('Blogs table created successfully');
    } catch (err) {
        console.error('Error creating blogs table:', err);
    } finally {
        pool.end();
    }
};

createBlogTable();
