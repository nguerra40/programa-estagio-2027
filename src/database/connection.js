/**
 * Banco de dados simples baseado em arquivo JSON.
 * Zero dependências nativas — funciona em qualquer container.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'solicitacoes.json');

// Cria pasta de dados se não existir
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cria arquivo se não existir
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

function readAll() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function insert(record) {
  const data = readAll();
  const newRecord = {
    id: Date.now(),
    ...record,
    created_at: new Date().toISOString()
  };
  data.push(newRecord);
  writeAll(data);
  return newRecord;
}

function findAll() {
  return readAll().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function findByEmail(email) {
  return readAll().filter(item => item.email.toLowerCase() === email.toLowerCase())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function update(id, updates) {
  const data = readAll();
  const index = data.findIndex(item => item.id === id);
  if (index === -1) return null;
  data[index] = { ...data[index], ...updates, updated_at: new Date().toISOString() };
  writeAll(data);
  return data[index];
}

function stats() {
  const data = readAll();
  const totalVagas = data.reduce((sum, item) => sum + parseInt(item.vagas), 0);
  const totalAreas = new Set(data.map(d => d.area)).size;
  return { totalVagas, totalAreas };
}

module.exports = { insert, findAll, findByEmail, update, stats };
