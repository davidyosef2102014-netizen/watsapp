const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATA STORE =====
const users = {};       // phone -> user object
const chats = {};       // chatId -> chat object
const channels = {};    // channelId -> channel
const statuses = {};    // userId -> [status]
const sessions = {};    // token -> { userId, phone }
const userSockets = {}; // userId -> [socketId]
const socketToUser = {};

// ===== AUTH API =====
app.post('/api/register', (req, res) => {
  const { phone, name, avatar } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  let user = users[phone];
  if (!user) {
    user = {
      id: uuidv4(), name: name || phone, phone,
      avatar: avatar || null, about: 'Hey there! I am using WatsApp.',
      status: 'online', lastSeen: null
    };
    users[phone] = user;
  } else {
    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
  }
  const token = uuidv4();
  sessions[token] = { userId: user.id, phone };
  res.json({ token, user });
});

app.get('/api/login/:phone', (req, res) => {
  const { phone } = req.params;
  let user = users[phone];
  if (!user) {
    user = {
      id: uuidv4(), name: phone, phone,
      avatar: null, about: 'Hey there! I am using WatsApp.',
      status: 'online', lastSeen: null
    };
    users[phone] = user;
  }
  const token = uuidv4();
  sessions[token] = { userId: user.id, phone };
  res.json({ token, user });
});

// Find user by phone
app.get('/api/users/find/:phone', authMiddleware, (req, res) => {
  const target = users[req.params.phone];
  if (!target) return res.status(404).json({ error: 'User not found' });
  res.json({ id: target.id, name: target.name, phone: target.phone, avatar: target.avatar, about: target.about, status: target.status });
});

app.put('/api/me', authMiddleware, (req, res) => {
  const { name, about, avatar } = req.body;
  const user = users[req.user.phone];
  if (name) user.name = name;
  if (about !== undefined) user.about = about;
  if (avatar) user.avatar = avatar;
  res.json(user);
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const myChats = Object.values(chats).filter(c => c.members.includes(req.user.id));
  const enriched = myChats.map(c => enrichChat(c, req.user.id));
  enriched.sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.timestamp : (a.createdAt || 0);
    const tb = b.lastMessage ? b.lastMessage.timestamp : (b.createdAt || 0);
    return tb - ta;
  });
  res.json(enriched);
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const chat = chats[req.params.chatId];
  if (!chat || !chat.members.includes(req.user.id)) return res.status(404).json({ error: 'Not found' });
  chat.messages.forEach(m => { if (m.senderId !== req.user.id) m.status = 'read'; });
  res.json(chat.messages);
});

app.get('/api/channels', authMiddleware, (req, res) => {
  res.json(Object.values(channels).filter(c => c.subscribers.includes(req.user.id)));
});

app.get('/api/channels/discover', authMiddleware, (req, res) => {
  res.json(Object.values(channels).filter(c => !c.subscribers.includes(req.user.id)));
});

app.post('/api/channels', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const ch = {
    id: uuidv4(), name, description: description || '',
    avatar: null, adminId: req.user.id,
    subscribers: [req.user.id], messages: [], createdAt: Date.now()
  };
  channels[ch.id] = ch;
  res.json(ch);
});

app.post('/api/channels/:channelId/subscribe', authMiddleware, (req, res) => {
  const ch = channels[req.params.channelId];
  if (!ch) return res.status(404).json({ error: 'Not found' });
  if (!ch.subscribers.includes(req.user.id)) ch.subscribers.push(req.user.id);
  res.json({ success: true });
});

app.get('/api/channels/:channelId/messages', authMiddleware, (req, res) => {
  const ch = channels[req.params.channelId];
  if (!ch) return res.status(404).json({ error: 'Not found' });
  res.json(ch.messages);
});

app.get('/api/statuses', authMiddleware, (req, res) => {
  const myChats = Object.values(chats).filter(c => c.type === 'private' && c.members.includes(req.user.id));
  const contactIds = [...new Set(myChats.flatMap(c => c.members.filter(id => id !== req.user.id)))];
  const result = contactIds
    .filter(id => statuses[id] && statuses[id].length > 0)
    .map(id => {
      const u = Object.values(users).find(u => u.id === id);
      return { user: u, statuses: statuses[id] };
    });
  res.json({ mine: statuses[req.user.id] || [], contacts: result });
});

function enrichChat(chat, myUserId) {
  const last = chat.messages[chat.messages.length - 1] || null;
  const unread = chat.messages.filter(m => m.senderId !== myUserId && m.status !== 'read').length;
  let name = chat.name, avatar = chat.avatar;
  if (chat.type === 'private') {
    const otherId = chat.members.find(id => id !== myUserId);
    const other = Object.values(users).find(u => u.id === otherId);
    if (other) { name = other.name; avatar = other.avatar; }
  }
  return { ...chat, displayName: name, displayAvatar: avatar, lastMessage: last, unreadCount: unread };
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization;
  const session = sessions[token];
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const user = users[session.phone];
  if (!user) return res.status(401).json({ error: 'Not found' });
  req.user = user;
  next();
}

// ===== SOCKET.IO =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const session = sessions[token];
  if (!session) return next(new Error('Unauthorized'));
  const user = users[session.phone];
  if (!user) return next(new Error('Not found'));
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  if (!userSockets[userId]) userSockets[userId] = [];
  userSockets[userId].push(socket.id);
  socketToUser[socket.id] = userId;

  users[socket.user.phone].status = 'online';
  users[socket.user.phone].lastSeen = null;

  // Join rooms
  Object.values(chats).forEach(c => { if (c.members.includes(userId)) socket.join(`chat:${c.id}`); });
  Object.values(channels).forEach(c => { if (c.subscribers.includes(userId)) socket.join(`channel:${c.id}`); });
  socket.join(`user:${userId}`);

  broadcastStatus(userId, 'online');

  socket.on('send_message', ({ chatId, text, imageData, voiceData, duration, replyTo }) => {
    const chat = chats[chatId];
    if (!chat || !chat.members.includes(userId)) return;
    const msg = {
      id: uuidv4(), senderId: userId, text: text || '',
      imageData: imageData || null, voiceData: voiceData || null,
      duration: duration || 0, replyTo: replyTo || null,
      timestamp: Date.now(), status: 'sent'
    };
    chat.messages.push(msg);
    io.to(`chat:${chatId}`).emit('new_message', { chatId, message: msg });

    setTimeout(() => {
      const online = chat.members.filter(id => id !== userId && userSockets[id]?.length > 0);
      if (online.length > 0) {
        msg.status = 'delivered';
        io.to(`user:${userId}`).emit('message_status', { chatId, messageId: msg.id, status: 'delivered' });
      }
    }, 400);
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    const chat = chats[chatId];
    if (!chat || !chat.members.includes(userId)) return;
    socket.to(`chat:${chatId}`).emit('user_typing', { chatId, userId, name: socket.user.name, isTyping });
  });

  socket.on('start_chat', ({ targetUserId }) => {
    const existing = Object.values(chats).find(c => c.type === 'private' && c.members.includes(userId) && c.members.includes(targetUserId));
    if (existing) { socket.emit('chat_opened', { chat: enrichChat(existing, userId) }); return; }
    const target = Object.values(users).find(u => u.id === targetUserId);
    if (!target) return;
    const newChat = { id: uuidv4(), type: 'private', members: [userId, targetUserId], messages: [], createdAt: Date.now() };
    chats[newChat.id] = newChat;
    io.to(`user:${userId}`).socketsJoin(`chat:${newChat.id}`);
    io.to(`user:${targetUserId}`).socketsJoin(`chat:${newChat.id}`);
    socket.emit('chat_opened', { chat: enrichChat(newChat, userId) });
    io.to(`user:${targetUserId}`).emit('new_chat', { chat: enrichChat(newChat, targetUserId) });
  });

  socket.on('create_group', ({ name, members, description }) => {
    const allMembers = [userId, ...members.filter(id => id !== userId)];
    const group = {
      id: uuidv4(), type: 'group', name, description: description || '',
      members: allMembers, messages: [], avatar: null, createdAt: Date.now(), createdBy: userId
    };
    chats[group.id] = group;
    allMembers.forEach(mid => io.to(`user:${mid}`).emit('new_group', { chat: enrichChat(group, mid) }));
    io.to(`user:${userId}`).socketsJoin(`chat:${group.id}`);
    allMembers.forEach(mid => io.to(`user:${mid}`).socketsJoin(`chat:${group.id}`));
    const sysMsg = { id: uuidv4(), senderId: 'system', text: `${socket.user.name} created group "${name}"`, timestamp: Date.now(), status: 'read' };
    group.messages.push(sysMsg);
    io.to(`chat:${group.id}`).emit('new_message', { chatId: group.id, message: sysMsg });
  });

  socket.on('post_status', ({ content, type, bgColor }) => {
    if (!statuses[userId]) statuses[userId] = [];
    const status = { id: uuidv4(), content, type: type || 'text', bgColor: bgColor || '#00BCD4', timestamp: Date.now(), viewers: [] };
    statuses[userId].unshift(status);
    setTimeout(() => {
      if (statuses[userId]) statuses[userId] = statuses[userId].filter(s => s.id !== status.id);
    }, 24 * 3600 * 1000);
    const contactIds = Object.values(chats)
      .filter(c => c.type === 'private' && c.members.includes(userId))
      .flatMap(c => c.members.filter(id => id !== userId));
    contactIds.forEach(cId => io.to(`user:${cId}`).emit('new_status', { userId, user: socket.user, status }));
    socket.emit('status_posted', status);
  });

  socket.on('channel_message', ({ channelId, text }) => {
    const ch = channels[channelId];
    if (!ch || ch.adminId !== userId) return;
    const msg = { id: uuidv4(), text, timestamp: Date.now(), type: 'text', reactions: {} };
    ch.messages.push(msg);
    io.to(`channel:${channelId}`).emit('channel_new_message', { channelId, message: msg });
  });

  socket.on('channel_react', ({ channelId, messageId, emoji }) => {
    const ch = channels[channelId];
    if (!ch || !ch.subscribers.includes(userId)) return;
    const msg = ch.messages.find(m => m.id === messageId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const idx = msg.reactions[emoji].indexOf(userId);
    if (idx > -1) msg.reactions[emoji].splice(idx, 1);
    else msg.reactions[emoji].push(userId);
    io.to(`channel:${channelId}`).emit('channel_reaction', { channelId, messageId, reactions: msg.reactions });
  });

  socket.on('mark_read', ({ chatId }) => {
    const chat = chats[chatId];
    if (!chat || !chat.members.includes(userId)) return;
    chat.messages.forEach(m => { if (m.senderId !== userId) m.status = 'read'; });
    const senderIds = [...new Set(chat.messages.map(m => m.senderId))].filter(id => id !== userId && id !== 'system');
    senderIds.forEach(sid => io.to(`user:${sid}`).emit('messages_read', { chatId, readBy: userId }));
  });

  socket.on('disconnect', () => {
    userSockets[userId] = (userSockets[userId] || []).filter(id => id !== socket.id);
    delete socketToUser[socket.id];
    if (!userSockets[userId]?.length) {
      users[socket.user.phone].status = 'offline';
      users[socket.user.phone].lastSeen = Date.now();
      broadcastStatus(userId, 'offline');
    }
  });
});

function broadcastStatus(userId, status) {
  const user = Object.values(users).find(u => u.id === userId);
  const contactIds = Object.values(chats)
    .filter(c => c.type === 'private' && c.members.includes(userId))
    .flatMap(c => c.members.filter(id => id !== userId));
  contactIds.forEach(cId => {
    io.to(`user:${cId}`).emit('contact_status', { userId, status, lastSeen: user?.lastSeen });
  });
}

const PORT = process.env.PORT || 3030;
server.listen(PORT, () => console.log(`WatsApp server on http://localhost:${PORT}`));
