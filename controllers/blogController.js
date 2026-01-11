const pool = require('../db');

exports.getAllBlogs = async (req, res) => {
    const { category } = req.query;
    try {
        let query = 'SELECT * FROM blogs';
        let values = [];

        if (category && category !== 'All') {
            query += ' WHERE category = $1';
            values.push(category);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching blogs:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

exports.getBlogById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM blogs WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Blog not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching blog:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

exports.createBlog = async (req, res) => {
    const { title, excerpt, content, category, author, image_url, read_time } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO blogs (title, excerpt, content, category, author, image_url, read_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [title, excerpt, content, category, author, image_url, read_time]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating blog:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

exports.deleteBlog = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM blogs WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Blog not found' });
        }
        res.json({ message: 'Blog deleted successfully' });
    } catch (err) {
        console.error('Error deleting blog:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
