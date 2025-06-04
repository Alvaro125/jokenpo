require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://alvaro.ferreira049:6t2uYJeLfgQF@ep-fragrant-paper-06412853-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('connect', () => {
    console.log('Conectado ao PostgreSQL!');
});

pool.on('error', (err) => {
    console.error('Erro inesperado no cliente PostgreSQL ocioso', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};