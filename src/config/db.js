require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.URL_DB,
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