// ===== STATE =====
let token = localStorage.getItem('wt_token') || null;
let currentUser = JSON.parse(localStorage.getItem('wt_user') || 'null');
let socket = null;
let chats = [];
let channels = [];
let allContacts = []; // users we've found/chatted with
let currentChatId = null;
let currentChannelId = null;
let typingTimeout = null;
let selectedGroupMembers = [];
let pendingImage = null;   // { dataUrl, name }
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let replyToMsg = null;

const EMOJIS = ['😀','😂','😍','🥰','😎','🤔','😮','😢','😡','👍','👎','❤️','🔥','🎉','🙏','💯','😅','🤣','😊','😭','😤','🤯','🥳','🤩','😴','🤒','👋','✌️','🤝','💪','🎵','🎮','⚽','🍕','🍔','☕','🌍','🚀','⭐','💡','📱','💻','🎁','🌈','🌙','☀️','❄️','🌺','🦋'];

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  buildEmojiGrid();

  if (token && currentUser) {
    showApp();
    connectSocket();
    loadData();
  }

  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('phone-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('phone-input').focus(); });

  // Avatar picker
  document.getElementById('avatar-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      loginAvatarData = ev.target.result;
      const inner = document.getElementById('avatar-picker-inner');
      inner.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover" />`;
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  document.getElementById('new-chat-btn').addEventListener('click', openNewChatModal);
  document.getElementById('close-new-chat').addEventListener('click', () => closeModal('new-chat-modal'));
  document.getElementById('contact-search').addEventListener('input', handleContactSearch);
  document.getElementById('new-group-row').addEventListener('click', openNewGroupModal);

  document.getElementById('close-new-group').addEventListener('click', () => closeModal('new-group-modal'));
  document.getElementById('create-group-btn').addEventListener('click', createGroup);

  document.getElementById('new-status-btn').addEventListener('click', () => showModal('status-modal'));
  document.getElementById('close-status-modal').addEventListener('click', () => closeModal('status-modal'));
  document.getElementById('send-status-btn').addEventListener('click', postStatus);
  document.getElementById('my-status-item').addEventListener('click', () => showModal('status-modal'));
  document.getElementById('close-status-btn').addEventListener('click', closeStatusView);

  document.getElementById('send-btn').addEventListener('click', sendMessage);
  const msgInput = document.getElementById('message-input');
  msgInput.addEventListener('input', onInputChange);
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    else handleTyping();
  });

  // Attach
  document.getElementById('attach-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('attach-menu').classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('attach-menu').classList.add('hidden'));

  document.getElementById('image-input').addEventListener('change', handleImageSelect);
  document.getElementById('doc-input').addEventListener('change', handleDocSelect);
  document.getElementById('img-preview-remove').addEventListener('click', clearImagePreview);

  // Voice
  document.getElementById('mic-btn').addEventListener('mousedown', startRecording);
  document.getElementById('mic-btn').addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
  document.getElementById('cancel-voice-btn').addEventListener('click', cancelRecording);
  document.getElementById('send-voice-btn').addEventListener('click', sendVoiceMessage);

  // Emoji
  document.getElementById('emoji-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('emoji-picker').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn')) {
      document.getElementById('emoji-picker').classList.add('hidden');
    }
  });

  document.getElementById('channel-send-btn').addEventListener('click', sendChannelMessage);
  document.getElementById('channel-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChannelMessage(); });
  document.getElementById('find-channels-btn').addEventListener('click', openDiscoverChannels);
  document.getElementById('close-discover-channels').addEventListener('click', () => closeModal('discover-channels-modal'));

  document.getElementById('search-input').addEventListener('input', renderChatList);

  // Mobile back button
  document.getElementById('back-btn').addEventListener('click', () => {
    currentChatId = null;
    document.getElementById('app').classList.remove('chat-open');
    document.getElementById('chat-window').classList.add('hidden');
    document.getElementById('channel-window').classList.add('hidden');
    document.getElementById('status-view').classList.add('hidden');
    document.getElementById('welcome-screen').classList.remove('hidden');
  });

  // Camera attach
  document.getElementById('camera-attach-btn').addEventListener('click', openCamera);
});

// ===== LOGIN =====
let loginAvatarData = null;

async function doLogin() {
  let phone = document.getElementById('phone-input').value.trim().replace(/[-\s]/g, '');
  const name = document.getElementById('name-input').value.trim();
  if (!phone) { showToast('נא להזין מספר טלפון'); return; }
  if (!name) { showToast('נא להזין שם'); return; }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name, avatar: loginAvatarData })
    });
    const data = await res.json();
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('wt_token', token);
    localStorage.setItem('wt_user', JSON.stringify(currentUser));
    showApp();
    connectSocket();
    loadData();
  } catch(e) { showToast('שגיאת חיבור'); }
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  if (currentUser.avatar) {
    document.getElementById('my-avatar').src = currentUser.avatar;
    document.getElementById('status-my-avatar').src = currentUser.avatar;
  } else {
    const initials = getInitials(currentUser.name);
    document.getElementById('my-avatar').outerHTML = `<div id="my-avatar" class="avatar-initials" style="background:${strToColor(currentUser.name)}">${initials}</div>`;
    document.getElementById('status-my-avatar').outerHTML = `<div id="status-my-avatar" class="avatar-initials" style="background:${strToColor(currentUser.name)}">${initials}</div>`;
  }
}

// ===== SOCKET =====
function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('connect', () => socket.emit('sync_request'));

  socket.on('new_message', ({ chatId, message }) => {
    let chat = chats.find(c => c.id === chatId);
    if (!chat) { loadData(); return; }
    chat.messages = chat.messages || [];
    chat.messages.push(message);
    if (chatId === currentChatId) {
      renderMessage(message, true);
      scrollToBottom();
      socket.emit('mark_read', { chatId });
      // clear typing
      document.getElementById('typing-indicator').classList.add('hidden');
    } else {
      chat.unreadCount = (chat.unreadCount || 0) + 1;
    }
    chat.lastMessage = message;
    renderChatList();
  });

  socket.on('new_group', ({ chat }) => {
    if (!chats.find(c => c.id === chat.id)) { chats.unshift(chat); renderChatList(); }
  });

  socket.on('new_chat', ({ chat }) => {
    if (!chats.find(c => c.id === chat.id)) { chats.unshift(chat); renderChatList(); }
  });

  socket.on('chat_opened', ({ chat }) => {
    if (!chats.find(c => c.id === chat.id)) { chats.unshift(chat); renderChatList(); }
    openChat(chat.id);
  });

  socket.on('user_typing', ({ chatId, name, isTyping }) => {
    if (chatId !== currentChatId) return;
    const ind = document.getElementById('typing-indicator');
    document.getElementById('typing-name').textContent = name;
    ind.classList.toggle('hidden', !isTyping);
  });

  socket.on('contact_status', ({ userId, status, lastSeen }) => {
    if (currentChatId) {
      const chat = chats.find(c => c.id === currentChatId);
      if (chat?.type === 'private' && chat.members.includes(userId)) {
        const el = document.getElementById('chat-header-status');
        if (el) {
          el.textContent = status === 'online' ? 'online' : (lastSeen ? 'last seen ' + formatTime(lastSeen) : 'offline');
          el.style.color = status === 'online' ? '#25D366' : '#667781';
        }
      }
    }
    allContacts.forEach(c => { if (c.id === userId) c.status = status; });
  });

  socket.on('messages_read', ({ chatId }) => {
    if (chatId === currentChatId) {
      document.querySelectorAll('.msg-group.out .check-svg').forEach(el => {
        el.outerHTML = doubleCheckSVG(true);
      });
    }
  });

  socket.on('channel_new_message', ({ channelId, message }) => {
    const ch = channels.find(c => c.id === channelId);
    if (ch) {
      ch.messages = ch.messages || [];
      ch.messages.push(message);
      if (channelId === currentChannelId) {
        renderChannelMessage(message);
        document.getElementById('channel-messages-area').scrollTop = 9999;
      }
    }
  });

  socket.on('channel_reaction', ({ channelId, messageId, reactions }) => {
    const ch = channels.find(c => c.id === channelId);
    if (ch) {
      const msg = (ch.messages || []).find(m => m.id === messageId);
      if (msg) msg.reactions = reactions;
    }
    if (channelId === currentChannelId) {
      const el = document.querySelector(`[data-msgid="${messageId}"] .channel-reactions`);
      if (el) el.innerHTML = reactionButtonsHTML(messageId, reactions);
    }
  });

  socket.on('status_posted', () => { loadStatuses(); showToast('סטטוס פורסם!'); });
  socket.on('new_status', () => loadStatuses());
  socket.on('disconnect', () => {});
}

// ===== DATA =====
async function loadData() {
  await Promise.all([loadChats(), loadChannels(), loadStatuses()]);
}

async function loadChats() {
  const res = await apiFetch('/api/chats');
  chats = await res.json();
  renderChatList();
}

async function loadChannels() {
  const res = await apiFetch('/api/channels');
  channels = await res.json();
  renderChannelList();
}

async function loadStatuses() {
  const res = await apiFetch('/api/statuses');
  const data = await res.json();
  renderStatuses(data);
}

// ===== RENDER CHAT LIST =====
function renderChatList() {
  const list = document.getElementById('chat-list');
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const filtered = chats.filter(c => !q || (c.displayName || '').toLowerCase().includes(q) || (c.lastMessage?.text || '').toLowerCase().includes(q));

  if (!filtered.length) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:#667781">
      <div style="font-size:40px;margin-bottom:12px">💬</div>
      <div>אין צ'אטים עדיין</div>
      <div style="font-size:13px;margin-top:6px">לחץ <b>צ'אט חדש</b> כדי להתחיל</div>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(chat => {
    const name = chat.displayName || chat.name || 'Unknown';
    const avatar = chat.displayAvatar || chat.avatar;
    const last = chat.lastMessage;
    let preview = '';
    if (last) {
      if (last.imageData) preview = '📷 תמונה';
      else if (last.voiceData) preview = '🎤 הודעה קולית';
      else preview = last.text || '';
      if (last.senderId === currentUser.id) preview = '✓ ' + preview;
    }
    const time = last ? formatTime(last.timestamp) : '';
    const unread = chat.unreadCount || 0;
    const isGroup = chat.type === 'group';

    return `<div class="chat-item ${chat.id === currentChatId ? 'active' : ''}" onclick="openChat('${chat.id}')">
      <div class="chat-avatar">${avatarHTML(avatar, name, 49)}${chat.id === currentChatId ? '' : (unread > 0 ? '' : '')}</div>
      <div class="chat-info">
        <div class="chat-top">
          <span class="chat-name">${isGroup ? '👥 ' : ''}${escHtml(name)}</span>
          <span class="chat-time" style="color:${unread > 0 ? '#25D366' : '#667781'}">${time}</span>
        </div>
        <div class="chat-bottom">
          <span class="chat-preview">${escHtml(preview)}</span>
          ${unread > 0 ? `<span class="chat-unread">${unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ===== OPEN CHAT =====
async function openChat(chatId) {
  currentChatId = chatId;
  currentChannelId = null;

  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;

  chat.unreadCount = 0;

  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-window').classList.remove('hidden');
  document.getElementById('channel-window').classList.add('hidden');
  document.getElementById('status-view').classList.add('hidden');

  let name = chat.displayName || chat.name || 'Unknown';
  let avatar = chat.displayAvatar || chat.avatar;

  // Header
  const headerAvatarEl = document.getElementById('chat-header-avatar');
  headerAvatarEl.outerHTML = `<div id="chat-header-avatar" style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0">${avatarHTML(avatar, name, 40)}</div>`;
  document.getElementById('chat-header-name').textContent = name;

  const statusEl = document.getElementById('chat-header-status');
  if (chat.type === 'private') {
    const otherId = chat.members.find(id => id !== currentUser.id);
    const other = allContacts.find(c => c.id === otherId);
    statusEl.textContent = other?.status === 'online' ? 'online' : 'offline';
    statusEl.style.color = other?.status === 'online' ? '#25D366' : '#667781';
  } else {
    statusEl.textContent = `${chat.members?.length || 0} members`;
    statusEl.style.color = '#667781';
  }

  // Load messages
  const res = await apiFetch(`/api/chats/${chatId}/messages`);
  const messages = await res.json();
  chat.messages = messages;
  renderMessages(messages);
  socket.emit('mark_read', { chatId });

  renderChatList();
  document.getElementById('message-input').focus();
  document.getElementById('app').classList.add('chat-open');
}

function renderMessages(messages) {
  const area = document.getElementById('messages-area');
  area.innerHTML = '';
  let lastDate = null;
  messages.forEach(msg => {
    const d = new Date(msg.timestamp).toDateString();
    if (d !== lastDate) {
      lastDate = d;
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = formatDate(msg.timestamp);
      area.appendChild(div);
    }
    renderMessage(msg, false);
  });
  scrollToBottom();
}

function renderMessage(msg, append) {
  const area = document.getElementById('messages-area');
  const isOut = msg.senderId === currentUser.id;
  const isSystem = msg.senderId === 'system';

  if (isSystem) {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.textContent = msg.text;
    area.appendChild(el);
    return;
  }

  const chat = chats.find(c => c.id === currentChatId);
  let senderName = '';
  if (chat?.type === 'group' && !isOut) {
    const sender = allContacts.find(c => c.id === msg.senderId) || { name: msg.senderId };
    senderName = sender.name;
  }

  const group = document.createElement('div');
  group.className = `msg-group ${isOut ? 'out' : 'in'}`;

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble${msg.imageData ? ' msg-image-bubble' : ''}`;

  let html = '';
  if (senderName) html += `<div class="msg-sender">${escHtml(senderName)}</div>`;
  if (msg.replyTo) {
    const replied = chat?.messages?.find(m => m.id === msg.replyTo);
    if (replied) html += `<div class="msg-reply-preview">↩ ${escHtml((replied.text || '').substring(0, 60))}</div>`;
  }

  if (msg.imageData) {
    html += `<img class="msg-image" src="${msg.imageData}" onclick="openLightbox('${msg.imageData.substring(0,30)}','${msg.id}')" alt="Photo" />`;
    if (msg.text) html += `<div class="msg-text">${escHtml(msg.text)}</div>`;
  } else if (msg.voiceData) {
    html += renderVoiceBubble(msg);
  } else {
    html += `<div class="msg-text">${escHtml(msg.text || '')}</div>`;
  }

  html += `<div class="msg-meta">
    <span>${formatTime(msg.timestamp)}</span>
    ${isOut ? `<span>${doubleCheckSVG(msg.status === 'read')}</span>` : ''}
  </div>`;

  bubble.innerHTML = html;
  bubble.ondblclick = () => { replyToMsg = msg; document.getElementById('message-input').placeholder = `↩ משיב ל: ${(msg.text || 'media').substring(0,30)}...`; document.getElementById('message-input').focus(); };

  group.appendChild(bubble);
  area.appendChild(group);

  // Init voice player if needed
  if (msg.voiceData) {
    initVoicePlayer(msg.id, msg.voiceData);
  }
}

function renderVoiceBubble(msg) {
  const bars = Array.from({ length: 20 }, (_, i) =>
    `<span style="height:${8 + Math.random() * 20}px;animation-delay:${i * 0.06}s"></span>`
  ).join('');
  const dur = msg.duration ? formatDuration(msg.duration) : '0:00';
  return `<div class="voice-msg">
    <button class="voice-play-btn" onclick="toggleVoice('${msg.id}')" id="vplay-${msg.id}">
      <svg id="vicon-${msg.id}" viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <div class="voice-waveform" id="vwave-${msg.id}">${bars}</div>
    <span class="voice-duration" id="vdur-${msg.id}">${dur}</span>
  </div>`;
}

const voicePlayers = {};
function initVoicePlayer(msgId, voiceData) {
  voicePlayers[msgId] = { audio: new Audio(voiceData), playing: false };
  const audio = voicePlayers[msgId].audio;
  audio.onended = () => {
    voicePlayers[msgId].playing = false;
    const icon = document.getElementById(`vicon-${msgId}`);
    if (icon) icon.outerHTML = `<svg id="vicon-${msgId}" viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const wave = document.getElementById(`vwave-${msgId}`);
    if (wave) wave.classList.remove('playing');
  };
}

function toggleVoice(msgId) {
  const p = voicePlayers[msgId];
  if (!p) return;
  if (p.playing) {
    p.audio.pause();
    p.playing = false;
    document.getElementById(`vicon-${msgId}`).outerHTML = `<svg id="vicon-${msgId}" viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    document.getElementById(`vwave-${msgId}`)?.classList.remove('playing');
  } else {
    // Pause all others
    Object.entries(voicePlayers).forEach(([id, pl]) => { if (id !== msgId && pl.playing) { pl.audio.pause(); pl.playing = false; } });
    p.audio.play();
    p.playing = true;
    const icon = document.getElementById(`vicon-${msgId}`);
    if (icon) icon.outerHTML = `<svg id="vicon-${msgId}" viewBox="0 0 24 24" width="20" height="20" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    document.getElementById(`vwave-${msgId}`)?.classList.add('playing');
  }
}

const imageLightboxData = {};
function openLightbox(key, msgId) {
  const chat = chats.find(c => c.id === currentChatId);
  const msg = chat?.messages.find(m => m.id === msgId);
  if (!msg?.imageData) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.onclick = () => lb.remove();
  lb.innerHTML = `<img src="${msg.imageData}" alt="Photo" />`;
  document.body.appendChild(lb);
}

function scrollToBottom() {
  const a = document.getElementById('messages-area');
  a.scrollTop = a.scrollHeight;
}

// ===== SEND =====
function onInputChange() {
  const hasText = document.getElementById('message-input').value.trim().length > 0 || pendingImage;
  document.getElementById('send-btn').classList.toggle('hidden', !hasText);
  document.getElementById('mic-btn').classList.toggle('hidden', hasText);
}

function sendMessage() {
  if (!currentChatId) return;
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text && !pendingImage) return;

  socket.emit('send_message', {
    chatId: currentChatId,
    text,
    imageData: pendingImage ? pendingImage.dataUrl : null,
    replyTo: replyToMsg ? replyToMsg.id : null
  });

  input.value = '';
  input.placeholder = 'Type a message';
  replyToMsg = null;
  clearImagePreview();
  onInputChange();
  socket.emit('typing', { chatId: currentChatId, isTyping: false });
}

function handleTyping() {
  if (!currentChatId) return;
  socket.emit('typing', { chatId: currentChatId, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', { chatId: currentChatId, isTyping: false }), 2000);
}

// ===== IMAGE =====
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('attach-menu').classList.add('hidden');
  const reader = new FileReader();
  reader.onload = ev => {
    pendingImage = { dataUrl: ev.target.result, name: file.name };
    document.getElementById('img-preview-thumb').src = ev.target.result;
    document.getElementById('img-preview-name').textContent = file.name;
    document.getElementById('img-preview-bar').classList.remove('hidden');
    onInputChange();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function handleDocSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('attach-menu').classList.add('hidden');
  showToast(`Document "${file.name}" - בקרוב!`);
  e.target.value = '';
}

function clearImagePreview() {
  pendingImage = null;
  document.getElementById('img-preview-bar').classList.add('hidden');
  document.getElementById('img-preview-thumb').src = '';
  onInputChange();
}

function openCamera() {
  document.getElementById('attach-menu').classList.add('hidden');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingImage = { dataUrl: ev.target.result, name: 'camera.jpg' };
      document.getElementById('img-preview-thumb').src = ev.target.result;
      document.getElementById('img-preview-name').textContent = 'תמונה ממצלמה';
      document.getElementById('img-preview-bar').classList.remove('hidden');
      onInputChange();
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ===== VOICE RECORDING =====
async function startRecording() {
  if (mediaRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = finalizeRecording;
    mediaRecorder.start();

    recordingSeconds = 0;
    document.getElementById('voice-rec-time').textContent = '0:00';
    document.getElementById('voice-recording-bar').classList.remove('hidden');
    document.getElementById('message-input-bar').classList.add('hidden') ;

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      document.getElementById('voice-rec-time').textContent = formatDuration(recordingSeconds);
    }, 1000);
  } catch(e) {
    showToast('אין גישה למיקרופון');
  }
}

function cancelRecording() {
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    mediaRecorder = null;
    audioChunks = [];
  }
  clearInterval(recordingTimer);
  document.getElementById('voice-recording-bar').classList.add('hidden');
  document.getElementById('message-input-bar').classList.remove('hidden');
}

function sendVoiceMessage() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
}

function finalizeRecording() {
  clearInterval(recordingTimer);
  const dur = recordingSeconds;
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const reader = new FileReader();
  reader.onload = ev => {
    if (currentChatId) {
      socket.emit('send_message', { chatId: currentChatId, text: '', voiceData: ev.target.result, duration: dur });
    }
  };
  reader.readAsDataURL(blob);

  mediaRecorder = null;
  audioChunks = [];
  document.getElementById('voice-recording-bar').classList.add('hidden');
  document.getElementById('message-input-bar').classList.remove('hidden');
}

// ===== EMOJI =====
function buildEmojiGrid() {
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = EMOJIS.map(e => `<button class="emoji-btn-item" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

function insertEmoji(emoji) {
  const input = document.getElementById('message-input');
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
  input.setSelectionRange(pos + emoji.length, pos + emoji.length);
  input.focus();
  document.getElementById('emoji-picker').classList.add('hidden');
  onInputChange();
}

// ===== CHANNELS =====
function renderChannelList() {
  const list = document.getElementById('channels-list');
  if (!channels.length) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:#667781">
      <div style="font-size:40px;margin-bottom:12px">📢</div>
      <div>אין ערוצים עדיין</div>
      <div style="font-size:13px;margin-top:6px">מצא ערוצים לעקוב!</div>
    </div>`;
    return;
  }
  list.innerHTML = channels.map(ch => {
    const lastMsg = ch.messages?.slice(-1)[0];
    return `<div class="channel-item ${ch.id === currentChannelId ? 'active' : ''}" onclick="openChannel('${ch.id}')">
      <div class="channel-avatar">${avatarHTML(ch.avatar, ch.name, 49)}</div>
      <div class="channel-info">
        <div class="channel-name">${escHtml(ch.name)} <span class="channel-verified">✓</span></div>
        <div class="channel-desc">${escHtml(lastMsg?.text || ch.description || '')}</div>
      </div>
    </div>`;
  }).join('');
}

async function openChannel(channelId) {
  currentChannelId = channelId;
  currentChatId = null;
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;

  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-window').classList.add('hidden');
  document.getElementById('channel-window').classList.remove('hidden');
  document.getElementById('status-view').classList.add('hidden');

  document.getElementById('channel-header-name').textContent = ch.name;
  const ha = document.getElementById('channel-header-avatar');
  ha.outerHTML = `<div id="channel-header-avatar" style="width:40px;height:40px;border-radius:50%;overflow:hidden">${avatarHTML(ch.avatar, ch.name, 40)}</div>`;
  document.getElementById('channel-header-subs').textContent = `${ch.subscribers.length} subscribers`;

  const adminBar = document.getElementById('channel-admin-bar');
  adminBar.style.display = ch.adminId === currentUser.id ? 'flex' : 'none';

  const res = await apiFetch(`/api/channels/${channelId}/messages`);
  ch.messages = await res.json();
  renderChannelMessages(ch.messages);
  renderChannelList();
}

function renderChannelMessages(msgs) {
  const area = document.getElementById('channel-messages-area');
  area.innerHTML = '';
  msgs.forEach(m => renderChannelMessage(m));
  area.scrollTop = area.scrollHeight;
}

function renderChannelMessage(msg) {
  const area = document.getElementById('channel-messages-area');
  const div = document.createElement('div');
  div.className = 'channel-msg';
  div.setAttribute('data-msgid', msg.id);
  div.innerHTML = `<div class="msg-text">${escHtml(msg.text)}</div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
    <div class="channel-reactions">${reactionButtonsHTML(msg.id, msg.reactions || {})}</div>`;
  area.appendChild(div);
}

function reactionButtonsHTML(msgId, reactions) {
  let html = Object.entries(reactions || {})
    .filter(([, u]) => u.length > 0)
    .map(([emoji, users]) => `<button class="reaction-btn ${users.includes(currentUser.id) ? 'reacted' : ''}" onclick="reactToChannel('${msgId}','${emoji}')">${emoji} ${users.length}</button>`)
    .join('');
  html += `<button class="add-reaction-btn" onclick="pickReaction('${msgId}')">+</button>`;
  return html;
}

function reactToChannel(msgId, emoji) {
  if (currentChannelId) socket.emit('channel_react', { channelId: currentChannelId, messageId: msgId, emoji });
}

function pickReaction(msgId) {
  const emojis = ['👍','❤️','😂','😮','😢','🙏','🔥','🎉'];
  const el = document.querySelector(`[data-msgid="${msgId}"]`);
  const picker = document.createElement('div');
  picker.style.cssText = 'position:absolute;background:white;border-radius:12px;padding:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);display:flex;gap:6px;z-index:999;font-size:22px;';
  emojis.forEach(e => {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;';
    btn.textContent = e;
    btn.onclick = () => { reactToChannel(msgId, e); picker.remove(); };
    picker.appendChild(btn);
  });
  el.appendChild(picker);
  setTimeout(() => picker.remove(), 3000);
}

function sendChannelMessage() {
  const input = document.getElementById('channel-input');
  const text = input.value.trim();
  if (!text || !currentChannelId) return;
  input.value = '';
  socket.emit('channel_message', { channelId: currentChannelId, text });
}

async function openDiscoverChannels() {
  const res = await apiFetch('/api/channels/discover');
  const list = await res.json();
  const el = document.getElementById('discover-channels-list');
  if (!list.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#667781">אין עוד ערוצים לגלות</div>';
  } else {
    el.innerHTML = list.map(ch => `
      <div class="discover-channel-item">
        <div class="discover-channel-info">
          ${avatarHTML(ch.avatar, ch.name, 49)}
          <div>
            <div style="font-weight:600">${escHtml(ch.name)}</div>
            <div style="font-size:12px;color:#667781">${ch.subscribers.length} subscribers · ${escHtml(ch.description)}</div>
          </div>
        </div>
        <button class="subscribe-btn" onclick="subscribeChannel('${ch.id}')">Follow</button>
      </div>`).join('');
  }
  showModal('discover-channels-modal');
}

async function subscribeChannel(id) {
  await apiFetch(`/api/channels/${id}/subscribe`, 'POST');
  showToast('עוקב!');
  closeModal('discover-channels-modal');
  loadChannels();
}

// ===== STATUS =====
function renderStatuses(data) {
  const myTime = document.getElementById('my-status-time');
  myTime.textContent = data.mine?.length ? 'Today, ' + formatTime(data.mine[0].timestamp) : 'Tap to add status update';

  const list = document.getElementById('contacts-status-list');
  list.innerHTML = (data.contacts || []).map(({ user, statuses: sts }) => `
    <div class="status-contact-item" onclick="viewStatus('${user.id}')">
      <div class="status-avatar-wrap" style="position:relative">
        ${avatarHTML(user.avatar, user.name, 49, 'status-ring')}
      </div>
      <div class="status-info">
        <div class="status-name">${escHtml(user.name)}</div>
        <div class="status-time">${formatTime(sts[0].timestamp)}</div>
      </div>
    </div>`).join('') || '';
}

async function viewStatus(userId) {
  const res = await apiFetch('/api/statuses');
  const data = await res.json();
  const contact = data.contacts.find(c => c.user.id === userId);
  if (!contact || !contact.statuses.length) return;

  const user = contact.user;
  const s = contact.statuses[0];

  document.getElementById('status-view-name').textContent = user.name;
  document.getElementById('status-view-time').textContent = formatTime(s.timestamp);
  document.getElementById('status-view-avatar').src = user.avatar || '';
  document.getElementById('status-view-content').innerHTML = `<div style="background:${s.bgColor || '#25D366'};padding:24px 32px;border-radius:12px;font-size:22px;font-weight:500;max-width:400px;text-align:center">${escHtml(s.content)}</div>`;

  const bar = document.getElementById('status-progress-bar');
  bar.style.width = '0%';
  setTimeout(() => bar.style.width = '100%', 100);

  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-window').classList.add('hidden');
  document.getElementById('channel-window').classList.add('hidden');
  document.getElementById('status-view').classList.remove('hidden');
  document.getElementById('app').classList.add('chat-open');
}

function closeStatusView() {
  document.getElementById('status-view').classList.add('hidden');
  if (currentChatId) {
    document.getElementById('chat-window').classList.remove('hidden');
  } else {
    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('app').classList.remove('chat-open');
  }
}

function postStatus() {
  const text = document.getElementById('status-text-input').value.trim();
  if (!text) { showToast('כתוב משהו קודם'); return; }
  const colors = ['#25D366','#7c4dff','#f44336','#4caf50','#ff9800','#e91e63'];
  const bgColor = colors[Math.floor(Math.random() * colors.length)];
  socket.emit('post_status', { content: text, type: 'text', bgColor });
  document.getElementById('status-text-input').value = '';
  closeModal('status-modal');
}

// ===== NEW CHAT MODAL =====
function openNewChatModal() {
  document.getElementById('contacts-list').innerHTML = `
    <div style="padding:20px;text-align:center;color:#667781">
      <div style="font-size:13px;margin-bottom:12px">הכנס מספר טלפון למצוא מישהו</div>
      <div style="display:flex;gap:8px;justify-content:center">
        <input type="tel" id="find-phone-input" placeholder="e.g. 0500000002" style="border:1px solid #e9edef;border-radius:8px;padding:10px 14px;font-size:15px;outline:none;flex:1;max-width:200px" />
        <button onclick="findUser()" style="background:#25D366;color:white;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;font-weight:600">Find</button>
      </div>
      <div id="find-result" style="margin-top:12px"></div>
    </div>`;
  showModal('new-chat-modal');
}

async function findUser() {
  const phone = document.getElementById('find-phone-input').value.trim().replace(/[-\s]/g, '');
  if (!phone) return;
  const resultEl = document.getElementById('find-result');
  resultEl.textContent = 'מחפש...';
  try {
    const res = await apiFetch(`/api/users/find/${encodeURIComponent(phone)}`);
    if (!res.ok) { resultEl.innerHTML = '<span style="color:#f44336">משתמש לא נמצא. בקש מהם להצטרף ל-watspp!</span>'; return; }
    const user = await res.json();
    if (!allContacts.find(c => c.id === user.id)) allContacts.push(user);
    resultEl.innerHTML = `
      <div class="contact-item" onclick="startChat('${user.id}')" style="border-radius:8px;margin-top:4px">
        ${avatarHTML(user.avatar, user.name, 49)}
        <div class="contact-info">
          <div class="contact-name">${escHtml(user.name)}</div>
          <div class="contact-about">${escHtml(user.about || 'Hey there!')}</div>
        </div>
        <button style="background:#25D366;color:white;border:none;border-radius:16px;padding:6px 14px;font-size:13px;cursor:pointer">שלח הודעה</button>
      </div>`;
  } catch(e) { resultEl.innerHTML = '<span style="color:#f44336">שגיאה בחיפוש</span>'; }
}

function handleContactSearch() {
  const q = document.getElementById('contact-search').value.toLowerCase();
  document.querySelectorAll('#contacts-list .contact-item').forEach(el => {
    const name = el.querySelector('.contact-name')?.textContent.toLowerCase() || '';
    el.style.display = name.includes(q) ? '' : 'none';
  });
}

function startChat(targetUserId) {
  closeModal('new-chat-modal');
  socket.emit('start_chat', { targetUserId });
}

// ===== NEW GROUP =====
function openNewGroupModal() {
  closeModal('new-chat-modal');
  selectedGroupMembers = [];

  // Only show people we've chatted with
  const knownIds = [...new Set(chats.filter(c => c.type === 'private').flatMap(c => c.members.filter(id => id !== currentUser.id)))];
  const known = knownIds.map(id => allContacts.find(c => c.id === id) || Object.values({}).find(u => u.id === id)).filter(Boolean);

  const list = document.getElementById('group-contacts-list');
  if (!known.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#667781">התחל צ\'אטים קודם כדי להוסיף אנשים לקבוצות</div>';
  } else {
    list.innerHTML = known.map(c => `
      <div class="contact-item" data-uid="${c.id}" onclick="toggleGroupMember('${c.id}','${escHtml(c.name).replace(/'/g, "\\'")}')">
        ${avatarHTML(c.avatar, c.name, 49)}
        <div class="contact-info">
          <div class="contact-name">${escHtml(c.name)}</div>
        </div>
        <div class="contact-check"><svg viewBox="0 0 12 9" width="12" height="9" fill="white"><path d="M1 4l3.5 3.5L11 1"/></svg></div>
      </div>`).join('');
  }
  renderSelectedMembers();
  showModal('new-group-modal');
}

function toggleGroupMember(uid, name) {
  const idx = selectedGroupMembers.findIndex(m => m.id === uid);
  document.querySelector(`[data-uid="${uid}"]`)?.classList.toggle('selected', idx === -1);
  if (idx > -1) selectedGroupMembers.splice(idx, 1);
  else selectedGroupMembers.push({ id: uid, name });
  renderSelectedMembers();
}

function renderSelectedMembers() {
  document.getElementById('selected-members').innerHTML = selectedGroupMembers.map(m =>
    `<div class="selected-chip">${escHtml(m.name)}<button onclick="toggleGroupMember('${m.id}','${m.name}')">×</button></div>`
  ).join('');
}

function createGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { showToast('הכנס שם קבוצה'); return; }
  if (!selectedGroupMembers.length) { showToast('הוסף לפחות חבר אחד'); return; }
  socket.emit('create_group', { name, members: selectedGroupMembers.map(m => m.id) });
  closeModal('new-group-modal');
  document.getElementById('group-name-input').value = '';
  selectedGroupMembers = [];
}

// ===== TABS =====
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => {
    const id = c.id.replace('tab-', '');
    c.classList.toggle('hidden', id !== name);
    c.classList.toggle('active', id === name);
  });
}

// ===== HELPERS =====
function apiFetch(url, method = 'GET', body = null) {
  return fetch(url, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null
  });
}

function avatarHTML(src, name, size, extraClass = '') {
  if (src) return `<img src="${src}" alt="${escHtml(name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" class="${extraClass}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><div style="display:none;width:${size}px;height:${size}px;border-radius:50%;background:${strToColor(name)};align-items:center;justify-content:center;color:white;font-weight:600;font-size:${Math.round(size*0.4)}px;flex-shrink:0">${getInitials(name)}</div>`;
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${strToColor(name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:${Math.round(size*0.4)}px;flex-shrink:0;${extraClass ? 'border:2.5px solid #25D366' : ''}">${getInitials(name)}</div>`;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function strToColor(str) {
  if (!str) return '#25D366';
  const colors = ['#f44336','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#ff9800','#795548'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function doubleCheckSVG(read) {
  const color = read ? '#53bdeb' : '#667781';
  return `<svg class="check-svg" viewBox="0 0 18 11" width="18" height="11" fill="${color}"><path d="M17.394.954a.595.595 0 0 0-.838 0l-6.57 6.57-1.59-1.59a.595.595 0 0 0-.838.839l2.01 2.01a.595.595 0 0 0 .838 0l7.988-7.99a.595.595 0 0 0 0-.839z"/><path d="M12.394.954a.595.595 0 0 0-.838 0L7.42 5.09l.838.838 4.136-4.136a.595.595 0 0 0 0-.838z"/></svg>`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now - d < 7 * 86400000) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString();
}

function formatDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const diff = now - d;
  if (diff < 2 * 86400000) return 'Yesterday';
  return d.toLocaleDateString();
}

function formatDuration(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window._toast);
  window._toast = setTimeout(() => t.classList.add('hidden'), 3000);
}
