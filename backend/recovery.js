    socket.on('delete_message', async (messageId) => {
      try {
          await db.deleteMessage(messageId);
          io.emit('message_deleted', messageId);
      } catch (err) {
          console.error('Error deleting message', err);
      }
  });

  // --- Collaborative Workspace ---
  socket.on('join_workspace', (room) => {
      socket.join(room);
  });
  
  socket.on('workspace_draw', ({ room, data }) => {
      socket.to(room).emit('workspace_draw_receive', data);
  });

  socket.on('workspace_undo', ({ room, strokeId }) => {
      socket.to(room).emit('workspace_undo_receive', { strokeId });
  });

  socket.on('workspace_clear', ({ room }) => {
      socket.to(room).emit('workspace_clear_receive', {});
  });

  socket.on('workspace_pointer', ({ room, data }) => {
      socket.to(room).emit('workspace_pointer_receive', {
          ip: socket.tailscaleIp,
          name: socket.tailscaleDeviceName,
          ...data
      });
  });

  socket.on('workspace_frames', ({ room, data }) => {
      socket.to(room).emit('workspace_frames_receive', data);
  });

  socket.on('workspace_frame_change', ({ room, data }) => {
      socket.to(room).emit('workspace_frame_change_receive', data);
  });

  // --- WebRTC Signaling ---
  socket.on('call_offer', (data) => {
      io.to(data.recipientId).emit('call_offer', { ...data, callerId: socket.tailscaleIp, callerName: socket.tailscaleDeviceName });
      sendPushNotification({ 
          content: `${socket.tailscaleDeviceName} is calling you...`, 
          senderName: 'Incoming Call' 
      }, data.recipientId);
  });

  socket.on('call_answer', (data) => {
      io.to(data.toId).emit('call_answer', data);
  });

  socket.on('ice_candidate', (data) => {
      io.to(data.toId).emit('ice_candidate', data);
  });

  socket.on('end_call', (data) => {
      if (data.toId) {
          io.to(data.toId).emit('end_call');
      }
  });

  socket.on('reject_call', (data) => {
      if (data.toId) {
          io.to(data.toId).emit('reject_call');
      }
  });

  // --- Voice Channels ---
  socket.on('join_voice_channel', async ({ channelId }) => {
      for (const cid in voiceRooms) {
          voiceRooms[cid] = voiceRooms[cid].filter(u => u.socketId !== socket.id);
          io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
          socket.leave(`channel_voice_${cid}`);
      }
      io.emit('active_voice_channels', voiceRooms);

      if (!voiceRooms[channelId]) voiceRooms[channelId] = [];
      
      const assignments = await db.getDeviceAssignments();
      const assignment = assignments.find(a => a.ip === socket.tailscaleIp);
      
      const userObj = {
          socketId: socket.id,
          ip: socket.tailscaleIp,
          name: socket.tailscaleDeviceName,
          profileId: assignment ? assignment.profileId : null
      };

      voiceRooms[channelId].push(userObj);
      socket.join(`channel_voice_${channelId}`);
      
      io.to(`channel_voice_${channelId}`).emit('voice_users_updated', { channelId, users: voiceRooms[channelId] });
      io.emit('active_voice_channels', voiceRooms);
  });

  socket.on('leave_voice_channel', () => {
      let changed = false;
      for (const cid in voiceRooms) {
          const idx = voiceRooms[cid].findIndex(u => u.socketId === socket.id);
          if (idx !== -1) {
              voiceRooms[cid].splice(idx, 1);
              io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
              socket.leave(`channel_voice_${cid}`);
              changed = true;
          }
      }
      if (changed) io.emit('active_voice_channels', voiceRooms);
  });

  socket.on('voice_signal', (data) => {
      io.to(data.toId).emit('voice_signal', {
          fromId: socket.id,
          type: data.type,
          payload: data.payload,
          peerIp: socket.tailscaleIp,
          peerName: socket.tailscaleDeviceName
      });
  });

  socket.on('disconnect', () => {
      let changed = false;
      for (const cid in voiceRooms) {
          const idx = voiceRooms[cid].findIndex(u => u.socketId === socket.id);
          if (idx !== -1) {
              voiceRooms[cid].splice(idx, 1);
              io.to(`channel_voice_${cid}`).emit('voice_users_updated', { channelId: cid, users: voiceRooms[cid] });
              changed = true;
          }
      }
      if (changed) io.emit('active_voice_channels', voiceRooms);

      console.log(`User disconnected: ${socket.tailscaleDeviceName}`);
      connectedIps.delete(socket.tailscaleIp);
      if (typeof peerActivities !== 'undefined') {
          peerActivities.delete(socket.tailscaleIp);
      }
      io.emit('activity_update', { ip: socket.tailscaleIp, activity: null });

      io.emit('peer_offline', { ip: socket.tailscaleIp });
      for (const [ip, sid] of peerSockets.entries()) {
          if (sid === socket.id) {
              peerSockets.delete(ip);
              break;
          }
      }
  });

  socket.on('reset_global_chat', async () => {
    try {
      await db.clearGlobalChat();
      io.emit('chat_cleared');
    } catch (err) {
      console.error('Error clearing global chat', err);
    }
  });

  socket.on('update_activity', (activity) => {
      if (activity) {
          peerActivities.set(socket.tailscaleIp, activity);
      } else {
          peerActivities.delete(socket.tailscaleIp);
      }
      io.emit('activity_update', { ip: socket.tailscaleIp, activity });
  });

  socket.on('update_status', (statusData) => {
      if (statusData) {
          peerStatuses.set(socket.tailscaleIp, statusData);
      } else {
          peerStatuses.delete(socket.tailscaleIp);
      }
      io.emit('status_update', { ip: socket.tailscaleIp, ...statusData });
  });

  socket.on('update_steam_info', (steamData) => {
      if (steamData && steamData.personaName) {
          peerSteamInfo.set(socket.tailscaleIp, {
              personaName: steamData.personaName,
              steamId: steamData.steamId || null,
              installedApps: steamData.installedApps || []
          });
      } else {
          peerSteamInfo.delete(socket.tailscaleIp);
      }
      io.emit('steam_info_update', { ip: socket.tailscaleIp, steamData: peerSteamInfo.get(socket.tailscaleIp) || null });
  });

  socket.on('file_offer', (data) => {
      io.to(data.recipientId).emit('file_offer', {
          senderId: socket.tailscaleIp,
          senderName: socket.tailscaleDeviceName,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
          offer: data.offer
      });
  });

  socket.on('file_answer', (data) => {
      io.to(data.recipientId).emit('file_answer', {
          senderId: socket.tailscaleIp,
          answer: data.answer
      });
  });

  socket.on('file_ice', (data) => {
      io.to(data.recipientId).emit('file_ice', {
          senderId: socket.tailscaleIp,
          candidate: data.candidate
      });
  });

  socket.on('request_folder_sync', (data) => {
      io.to(data.recipientId).emit('request_folder_sync', {
          senderId: socket.tailscaleIp,
          folderName: data.folderName
      });
  });

  socket.on('folder_sync_progress', (data) => {
      io.to(data.recipientId).emit('folder_sync_progress', {
          senderId: socket.tailscaleIp,
          status: data.status,
          progress: data.progress,
          currentFile: data.currentFile,
          eta: data.eta,
          speed: data.speed
      });
  });

  socket.on('folder_sync_chunk', (data) => {
      io.to(data.recipientId).emit('folder_sync_chunk', {
          senderId: socket.tailscaleIp,
          chunk: data.chunk,
          index: data.index,
          total: data.total
      });
  });

  socket.on('folder_sync_complete', (data) => {
      io.to(data.recipientId).emit('folder_sync_complete', {
          senderId: socket.tailscaleIp,
          folderName: data.folderName
      });
  });

  socket.on('p2p_file_start', (data) => {
      io.to(data.recipientId).emit('p2p_file_start', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType
      });
  });

  socket.on('p2p_file_chunk', (data) => {
      io.to(data.recipientId).emit('p2p_file_chunk', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName,
          chunk: data.chunk,
          index: data.index,
          totalChunks: data.totalChunks
      });
  });

  socket.on('p2p_file_complete', (data) => {
      io.to(data.recipientId).emit('p2p_file_complete', {
          senderId: socket.tailscaleIp,
          fileName: data.fileName
      });
  });

});

// --- Multi-Agent Support ---
async function handleAgentMessage(socket, triggerMessage, channelId, recipientId, agentName, specificModel, cleanPrompt) {
    const settings = await db.getSettings();
    const openWebUiUrl = settings['openwebui_url'] || process.env.OPENWEBUI_URL || 'http://localhost:3000';
    const apiKey = settings['openwebui_api_key'] || process.env.OPENWEBUI_API_KEY || '';
    if (!cleanPrompt) return;

    try {
        let contextMessages = [];
        if (!recipientId) {
            contextMessages = await db.getMessages(null, null, channelId, 20);
        } else {
            contextMessages = await db.getMessages(socket.tailscaleIp, recipientId, null, 20);
        }

        const chatHistory = contextMessages.map(m => ({
            role: m.senderId === 'mimir' ? 'assistant' : 'user',
            content: `${m.senderName}: ${m.content}`
        }));

        chatHistory.push({
            role: 'system',
            content: `You are ${agentName}, a helpful AI assistant operating within the Jellychat interface. Your primary purpose is to assist users with their questions and tasks.`
        });

        // --- Sandbox Context Injection ---
        let mentionedSandboxId = null;
        const sandboxMatch = cleanPrompt.match(/SB\d+/i);
        if (sandboxMatch) {
            mentionedSandboxId = sandboxMatch[0].toUpperCase();
            if (activeSandboxes[channelId] && activeSandboxes[channelId][mentionedSandboxId]) {
                const sbData = activeSandboxes[channelId][mentionedSandboxId];
                chatHistory.push({
                    role: 'system',
                    content: `The user mentioned sandbox ${mentionedSandboxId}. Here is its current code (language: ${sbData.language}):\n\`\`\`${sbData.language}\n${sbData.code}\n\`\`\`\n\nIf the user asks you to modify or fix it, simply output the new code wrapped in a markdown code block. Do NOT include any other code blocks.`
                });
            }
        }

        const botMessage = await db.saveMessage(agentName.toLowerCase(), agentName, '', recipientId, 'text', null, null, triggerMessage.id, channelId);

        if (!recipientId) {
            io.to(`channel_${channelId}`).emit('new_message', botMessage);
        } else {
            io.to(recipientId).emit('new_message', botMessage);
            socket.emit('new_message', botMessage);
        }

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        let model = specificModel || settings['openwebui_model'] || process.env.OPENWEBUI_MODEL;
        if (!model) {
            try {
                const modelsRes = await fetch(`${openWebUiUrl}/api/models`, { headers });
                if (modelsRes.ok) {
                    const modelsData = await modelsRes.json();
                    if (modelsData.data && modelsData.data.length > 0) {
                        model = modelsData.data[0].id;
                    }
                }
            } catch (e) {
                console.warn('Could not auto-fetch models from openwebui');
            }
        }
        if (!model) model = 'llama3';

        const response = await fetch(`${openWebUiUrl}/api/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    ...chatHistory,
                    { role: 'user', content: cleanPrompt }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('AI Error:', response.statusText, errorText);
            const errorMessage = `Error: ${response.statusText}\n\`\`\`json\n${errorText}\n\`\`\``;
            const updatedBotMsg = await db.saveMessage(agentName.toLowerCase(), agentName, errorMessage, recipientId, 'text', null, null, triggerMessage.id, channelId);
            updatedBotMsg.id = botMessage.id;
            if (!recipientId) {
                io.to(`channel_${channelId}`).emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
            } else {
                io.to(recipientId).emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
                socket.emit('mimir_stream', { messageId: botMessage.id, chunk: errorMessage, fullContent: errorMessage });
            }
        } else {
            let fullResponse = '';
            const reader = response.body;
            const decoder = new TextDecoder();

            for await (const chunk of reader) {
                const text = decoder.decode(chunk, { stream: true });
                const lines = text.split('\n').filter(line => line.trim().startsWith('data:'));

                for (const line of lines) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
                        
                        if (reasoning) {
                            if (!fullResponse.includes('<think>')) {
                                fullResponse += '<think>\n';
                            }
                            fullResponse += reasoning;
                            io.emit('mimir_stream', { messageId: botMessage.id, chunk: reasoning, fullContent: fullResponse });
                        }

                        if (delta) {
                            if (fullResponse.includes('<think>') && !fullResponse.includes('</think>')) {
                                fullResponse += '\n</think>\n\n';
                            }
                            fullResponse += delta;
                            io.emit('mimir_stream', { messageId: botMessage.id, chunk: delta, fullContent: fullResponse });
                        }
                    } catch (e) { }
                }
            }

            if (fullResponse) {
                await db.editMessage(botMessage.id, fullResponse);
                io.emit('message_edited', { messageId: botMessage.id, newContent: fullResponse });
                
                if (mentionedSandboxId && activeSandboxes[channelId] && activeSandboxes[channelId][mentionedSandboxId]) {
                    const codeBlockMatch = fullResponse.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        const extractedCode = codeBlockMatch[1];
                        activeSandboxes[channelId][mentionedSandboxId].code = extractedCode;
                        io.emit('sandbox:update', { sandboxId: mentionedSandboxId, code: extractedCode });
                    }
                }
                
            } else {
                const fallback = '?? I got an empty response. Try asking again!';
                await db.editMessage(botMessage.id, fallback);
                io.emit('message_edited', { messageId: botMessage.id, newContent: fallback });
            }
        }
    } catch (err) {
        console.error('AI Request failed', err);
        io.to(`channel_${channelId}`).emit('new_message', await db.saveMessage(agentName.toLowerCase(), agentName, `Error: Could not reach AI server.`, recipientId, 'text', null, null, triggerMessage.id, channelId));
    }
}
