require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DATABASE_PROJECT_MYSQL_HOST,
  port: Number(process.env.DATABASE_PROJECT_MYSQL_PORT),
  user: process.env.DATABASE_PROJECT_MYSQL_USERNAME,
  password: process.env.DATABASE_PROJECT_MYSQL_PASSWORD,
  database: process.env.DATABASE_PROJECT_MYSQL_NAME,
  waitForConnections: true,
  connectionLimit: 10,

  dateStrings: true,
});

module.exports = { pool };