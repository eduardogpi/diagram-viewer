import mysql from "mysql2/promise";

export type MySQLConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export async function testMySQLConnection(config: MySQLConnectionConfig) {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 5000,
  });

  await connection.query("SELECT 1");
  await connection.end();
}
