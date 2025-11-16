import * as whatsapp from './whatsapp.js';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;

function getAdminStatusMessage(adminStatus, adminNumber, groupName) {
  switch (adminStatus.status) {
    case 'success':
      return `✅ ${adminNumber} successfully added and promoted to admin in ${groupName}`;
    case 'invited':
      return `📨 ${adminNumber} has been sent an invite link for ${groupName} (will be promoted after joining)`;
    case 'skipped':
      return `⚠️ Skipped adding ${adminNumber} to ${groupName}: ${adminStatus.reason}`;
    case 'not_found':
      return `❌ ${adminNumber} not found on WhatsApp, skipped for ${groupName}`;
    case 'failed':
      return `❌ Failed to add ${adminNumber} to ${groupName}: ${adminStatus.reason}`;
    case 'error':
      return `❌ Error adding ${adminNumber} to ${groupName}: ${adminStatus.reason}`;
    default:
      return `❓ Unknown status for ${adminNumber} in ${groupName}`;
  }
}

async function addAdminToGroup(client, groupId, groupName, adminNumber, inviteLink) {
  try {
    const normalizedNumber = adminNumber.replace(/[^\d]/g, '');
    
    if (normalizedNumber.length < 10) {
      console.log(`⚠️ Admin number ${adminNumber} seems invalid (too short), skipping admin addition for ${groupName}`);
      return { status: 'skipped', reason: 'Invalid number format' };
    }

    const adminId = `${normalizedNumber}@c.us`;
    
    let numberExists = false;
    try {
      const contact = await client.getNumberId(normalizedNumber);
      numberExists = contact && contact._serialized;
    } catch (checkError) {
      console.log(`⚠️ Could not verify if ${normalizedNumber} exists on WhatsApp for ${groupName}`);
      numberExists = true;
    }

    if (!numberExists) {
      console.log(`⚠️ Number ${normalizedNumber} not found on WhatsApp, skipping admin addition for ${groupName}`);
      return { status: 'not_found', reason: 'Number not on WhatsApp' };
    }

    try {
      const chat = await client.getChatById(groupId);
      await chat.addParticipants([adminId]);
      console.log(`✅ Added ${normalizedNumber} to group ${groupName}`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await chat.promoteParticipants([adminId]);
      console.log(`✅ Promoted ${normalizedNumber} to admin in group ${groupName}`);
      
      return { status: 'success', action: 'added_and_promoted' };
      
    } catch (addError) {
      console.log(`⚠️ Could not add ${normalizedNumber} to ${groupName} directly:`, addError.message);
      
      try {
        const inviteMessage = `🎉 You've been invited to join "${groupName}" as an admin!\n\nJoin here: ${inviteLink}\n\nYou will be promoted to admin once you join.`;
        await client.sendMessage(adminId, inviteMessage);
        console.log(`✅ Sent invite link to ${normalizedNumber} for ${groupName}`);
        
        return { status: 'invited', action: 'sent_invite_link' };
        
      } catch (dmError) {
        console.log(`❌ Failed to send DM invite to ${normalizedNumber} for ${groupName}:`, dmError.message);
        return { status: 'failed', reason: 'Could not add or invite' };
      }
    }
    
  } catch (error) {
    console.log(`❌ Error in addAdminToGroup for ${groupName}:`, error.message);
    return { status: 'error', reason: error.message };
  }
}

export async function createGroups(req, res) {
  try {
    const { name, count, adminNumber, groupImage, groupImageName, groupDescription } = req.body;
    const userId = req.headers['user-id'] || req.body.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!name || !count || count < 1 || count > 30) {
      return res.status(400).json({ error: 'Invalid group name or count' });
    }

    const nameParts = name.split(" ");
    let startNumber = parseInt(nameParts[nameParts.length - 1]);
    let baseName = nameParts.slice(0, nameParts.length - 1).join(" ");
    
    if (isNaN(startNumber)) {
      startNumber = 1;
      baseName = name;
    }
    
    console.log(`Starting group creation: Base name "${baseName}", Starting from ${startNumber}, Count: ${count}`);

    const client = whatsapp.getSock(userId);
    if (!client) {
      return res.status(500).json({ error: 'WhatsApp not connected for this user' });
    }

    const links = [];
    const failedGroups = [];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    res.write(`data: ${JSON.stringify({
      type: 'start',
      totalGroups: count,
      startNumber: startNumber,
      baseName: baseName,
      message: `Starting to create ${count} groups from "${baseName} ${startNumber}"`
    })}\n\n`);

    for (let i = 0; i < count; i++) {
      const groupNumber = startNumber + i;
      const groupName = `${baseName} ${groupNumber}`;

      try {
        const currentClient = whatsapp.getSock(userId);
        if (!currentClient) {
          console.log(`❌ Connection lost for user ${userId}, skipping remaining groups...`);
          res.write(`data: ${JSON.stringify({
            type: 'error',
            message: 'WhatsApp connection lost. Please reconnect and try again.',
            current: i + 1,
            total: count
          })}\n\n`);
          break;
        }

        console.log(`Creating group ${i + 1}/${count}: ${groupName}`);

        const group = await currentClient.createGroup(groupName, []);
        const groupId = group.gid._serialized;
        console.log(`✅ Group "${groupName}" created with ID: ${groupId}`);

        await new Promise(resolve => setTimeout(resolve, 3000));

        let addMembersWarning = false;
        try {
          const activeCli = whatsapp.getSock(userId);
          if (activeCli) {
            const chat = await activeCli.getChatById(groupId);
            
            await chat.setMessagesAdminsOnly(false);
            console.log(`✅ Setting: Enabled messaging for all members in ${groupName}`);
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await chat.setInfoAdminsOnly(false);
            console.log(`✅ Setting: Enabled group info editing for all members in ${groupName}`);
          }
        } catch (settingsError) {
          console.log(`⚠️ Warning: Could not configure all settings for ${groupName}:`, settingsError.message);
          addMembersWarning = true;
        }

        if (groupDescription) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'description',
              action: 'setting',
              groupName: groupName,
              description: groupDescription,
              message: `Setting description for ${groupName}...`
            })}\n\n`);

            const descCli = whatsapp.getSock(userId);
            if (descCli) {
              const chat = await descCli.getChatById(groupId);
              await chat.setDescription(groupDescription);
              console.log(`✅ Description set for ${groupName}: "${groupDescription}"`);
              
              res.write(`data: ${JSON.stringify({
                type: 'description',
                action: 'success',
                groupName: groupName,
                message: `✅ Description set for ${groupName}`
              })}\n\n`);
            }
          } catch (descError) {
            console.log(`❌ Failed to set description for ${groupName}:`, descError.message);
            res.write(`data: ${JSON.stringify({
              type: 'description',
              action: 'failed',
              groupName: groupName,
              error: descError.message,
              message: `❌ Failed to set description for ${groupName}: ${descError.message}`
            })}\n\n`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (groupImage) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'image',
              action: 'setting',
              groupName: groupName,
              imageName: groupImageName || 'uploaded image',
              message: `Setting profile picture for ${groupName}...`
            })}\n\n`);

            const imgCli = whatsapp.getSock(userId);
            if (imgCli) {
              const chat = await imgCli.getChatById(groupId);
              const base64Data = groupImage.replace(/^data:image\/[a-z]+;base64,/, '');
              const mimeMatch = groupImage.match(/^data:image\/([a-z]+);base64,/);
              const mimetype = mimeMatch ? `image/${mimeMatch[1]}` : 'image/jpeg';
              
              const media = new MessageMedia(mimetype, base64Data, groupImageName || 'profile.jpg');
              
              await chat.setPicture(media);
              console.log(`✅ Profile picture set for ${groupName} from uploaded file: ${groupImageName || 'image'}`);
              
              res.write(`data: ${JSON.stringify({
                type: 'image',
                action: 'success',
                groupName: groupName,
                message: `✅ Profile picture set for ${groupName}`
              })}\n\n`);
            }
          } catch (imgError) {
            console.log(`❌ Failed to set profile picture for ${groupName}:`, imgError.message);
            res.write(`data: ${JSON.stringify({
              type: 'image',
              action: 'failed',
              groupName: groupName,
              error: imgError.message,
              message: `❌ Failed to set profile picture for ${groupName}: ${imgError.message}`
            })}\n\n`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        let inviteCode;
        try {
          const activeCli = whatsapp.getSock(userId);
          if (activeCli) {
            const chat = await activeCli.getChatById(groupId);
            inviteCode = await chat.getInviteCode();
          }
        } catch (inviteError) {
          console.log(`❌ Failed to get invite code for ${groupName}:`, inviteError.message);
        }

        if (inviteCode) {
          const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
          links.push({
            groupName,
            link: inviteLink,
            groupId: groupId
          });
          console.log(`✅ Invite link generated for ${groupName}`);

          let adminStatus = null;
          if (adminNumber && adminNumber.trim()) {
            try {
              console.log(`🔄 Adding admin ${adminNumber} to ${groupName}...`);
              
              res.write(`data: ${JSON.stringify({
                type: 'admin',
                action: 'adding',
                groupName: groupName,
                adminNumber: adminNumber,
                message: `Adding admin ${adminNumber} to ${groupName}...`
              })}\n\n`);

              const adminCli = whatsapp.getSock(userId);
              if (adminCli) {
                adminStatus = await addAdminToGroup(adminCli, groupId, groupName, adminNumber, inviteLink);
                
                res.write(`data: ${JSON.stringify({
                  type: 'admin',
                  action: 'result',
                  groupName: groupName,
                  adminNumber: adminNumber,
                  status: adminStatus.status,
                  reason: adminStatus.reason || adminStatus.action,
                  message: getAdminStatusMessage(adminStatus, adminNumber, groupName)
                })}\n\n`);
              } else {
                console.log(`⚠️ WhatsApp connection lost, skipping admin addition for ${groupName}`);
                adminStatus = { status: 'skipped', reason: 'Connection lost' };
              }
            } catch (adminError) {
              console.log(`❌ Error adding admin to ${groupName}:`, adminError.message);
              adminStatus = { status: 'error', reason: adminError.message };
              
              res.write(`data: ${JSON.stringify({
                type: 'admin',
                action: 'error',
                groupName: groupName,
                adminNumber: adminNumber,
                message: `Failed to add admin to ${groupName}: ${adminError.message}`
              })}\n\n`);
            }
          }

          res.write(`data: ${JSON.stringify({
            type: 'link',
            groupName: groupName,
            link: inviteLink,
            groupId: groupId,
            current: i + 1,
            total: count,
            addMembersWarning: addMembersWarning,
            adminStatus: adminStatus
          })}\n\n`);
        } else {
          failedGroups.push(groupName);
          console.log(`❌ Failed to get invite code for ${groupName}`);

          res.write(`data: ${JSON.stringify({
            type: 'failed',
            groupName: groupName,
            current: i + 1,
            total: count,
            reason: 'Failed to get invite code'
          })}\n\n`);
        }

      } catch (error) {
        failedGroups.push(groupName);
        console.error(`❌ Error creating group ${groupName}:`, error.message);

        res.write(`data: ${JSON.stringify({
          type: 'failed',
          groupName: groupName,
          current: i + 1,
          total: count,
          reason: error.message
        })}\n\n`);
      }

      if (i < count - 1) {
        console.log(`⏳ Waiting 10 seconds before next group...`);

        res.write(`data: ${JSON.stringify({
          type: 'wait',
          current: i + 1,
          total: count,
          delaySeconds: 10,
          message: `Waiting 10 seconds before creating next group...`
        })}\n\n`);

        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    if (links.length > 0) {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${baseName.replace(/\s+/g, '_')}_${timestamp}.txt`;
        const filepath = `./generated_links/${filename}`;
        
        if (!fs.existsSync('./generated_links')) {
          fs.mkdirSync('./generated_links');
        }

        let fileContent = `WhatsApp Group Links - ${baseName}\n`;
        fileContent += `Created: ${new Date().toLocaleString()}\n`;
        fileContent += `Total Groups: ${links.length}\n\n`;
        
        links.forEach((link, index) => {
          fileContent += `${index + 1}. ${link.groupName}\n`;
          fileContent += `   ${link.link}\n\n`;
        });

        fs.writeFileSync(filepath, fileContent);
        console.log(`✅ Links saved to file: ${filename}`);
      } catch (fileError) {
        console.error('❌ Error saving links to file:', fileError.message);
      }
    }

    const summary = {
      type: 'complete',
      success: true,
      totalRequested: count,
      successfulGroups: links.length,
      failedGroups: failedGroups.length,
      failed: failedGroups,
      message: `✅ Group creation completed: ${links.length}/${count} successful`,
      startNumber: startNumber,
      baseName: baseName
    };

    res.write(`data: ${JSON.stringify(summary)}\n\n`);
    res.end();
    console.log(`🎉 Group creation completed: ${links.length}/${count} successful`);

  } catch (error) {
    console.error('❌ Critical error in createGroups:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to create groups', 
        details: error.message 
      });
    }
  }
}
