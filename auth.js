
import fs from 'fs';

function loadCodes() {
  try {
    return JSON.parse(fs.readFileSync('auth_codes.json', 'utf8'));
  } catch (error) {
    return ["8928863349"];
  }
}

function saveCodes(codes) {
  fs.writeFileSync('auth_codes.json', JSON.stringify(codes, null, 2));
}

function loadNotice() {
  try {
    return JSON.parse(fs.readFileSync('notice.json', 'utf8'));
  } catch (error) {
    return { notice: "" };
  }
}

function saveNotice(notice) {
  fs.writeFileSync('notice.json', JSON.stringify({ notice }, null, 2));
}

const ADMIN_CODE = "9209778319";

export function login(req, res) {
  const { code } = req.body;
  const codes = loadCodes();
  
  console.log('Login attempt with code:', code);
  console.log('Available codes:', codes);
  console.log('Admin code:', ADMIN_CODE);
  
  if (codes.includes(code)) {
    const isAdmin = code === ADMIN_CODE;
    console.log('Login successful for:', code, 'Admin:', isAdmin);
    res.status(200).json({ success: true, isAdmin });
  } else {
    console.log('Login failed - code not found');
    res.status(403).json({ error: 'Invalid Code' });
  }
}

export function getUsers(req, res) {
  const codes = loadCodes();
  res.json({ users: codes });
}

export function addUser(req, res) {
  const { code } = req.body;
  
  if (!code || code.length !== 10) {
    return res.status(400).json({ error: 'Invalid code format' });
  }
  
  const codes = loadCodes();
  
  if (codes.includes(code)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  codes.push(code);
  saveCodes(codes);
  
  res.json({ success: true, message: 'User added successfully' });
}

export function removeUser(req, res) {
  const { code } = req.body;
  
  if (code === ADMIN_CODE) {
    return res.status(400).json({ error: 'Cannot remove admin user' });
  }
  
  const codes = loadCodes();
  const index = codes.indexOf(code);
  
  if (index === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  codes.splice(index, 1);
  saveCodes(codes);
  
  res.json({ success: true, message: 'User removed successfully' });
}

export function getNotice(req, res) {
  const noticeData = loadNotice();
  res.json({ notice: noticeData.notice });
}

export function updateNotice(req, res) {
  const { notice } = req.body;
  
  if (typeof notice !== 'string') {
    return res.status(400).json({ error: 'Invalid notice format' });
  }
  
  saveNotice(notice);
  res.json({ success: true, message: 'Notice updated successfully' });
}
