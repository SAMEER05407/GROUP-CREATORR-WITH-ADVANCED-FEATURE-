
const whatsapp = require('./whatsapp');
const fs = require('fs');

// Helper function to get user-friendly message for admin status
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

// Helper function to add admin to group
async function addAdminToGroup(sock, groupId, groupName, adminNumber, inviteLink) {
  try {
    // Normalize phone number - remove spaces, dashes, plus signs and ensure digits only
    const normalizedNumber = adminNumber.replace(/[^\d]/g, '');
    
    // Ensure number has country code (if less than 10 digits, it's likely missing country code)
    if (normalizedNumber.length < 10) {
      console.log(`⚠️ Admin number ${adminNumber} seems invalid (too short), skipping admin addition for ${groupName}`);
      return { status: 'skipped', reason: 'Invalid number format' };
    }

    const adminJid = `${normalizedNumber}@s.whatsapp.net`;
    
    // Check if number exists on WhatsApp
    let numberExists = false;
    try {
      const [result] = await sock.onWhatsApp(normalizedNumber);
      numberExists = result && result.exists;
    } catch (checkError) {
      console.log(`⚠️ Could not verify if ${normalizedNumber} exists on WhatsApp for ${groupName}`);
      numberExists = true; // Assume it exists and try anyway
    }

    if (!numberExists) {
      console.log(`⚠️ Number ${normalizedNumber} not found on WhatsApp, skipping admin addition for ${groupName}`);
      return { status: 'not_found', reason: 'Number not on WhatsApp' };
    }

    // Try to add the number to the group
    try {
      await sock.groupParticipantsUpdate(groupId, [adminJid], 'add');
      console.log(`✅ Added ${normalizedNumber} to group ${groupName}`);
      
      // Wait 2 seconds before promoting to admin
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Promote to admin
      await sock.groupParticipantsUpdate(groupId, [adminJid], 'promote');
      console.log(`✅ Promoted ${normalizedNumber} to admin in group ${groupName}`);
      
      return { status: 'success', action: 'added_and_promoted' };
      
    } catch (addError) {
      console.log(`⚠️ Could not add ${normalizedNumber} to ${groupName} directly:`, addError.message);
      
      // Fallback: Send invite link via DM
      try {
        const inviteMessage = `🎉 You've been invited to join "${groupName}" as an admin!\n\nJoin here: ${inviteLink}\n\nYou will be promoted to admin once you join.`;
        await sock.sendMessage(adminJid, { text: inviteMessage });
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

exports.createGroups = async (req, res) => {
  try {
    const { name, count, adminNumber, groupImage, groupImageName, groupDescription } = req.body;
    const userId = req.headers['user-id'] || req.body.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!name || !count || count < 1 || count > 30) {
      return res.status(400).json({ error: 'Invalid group name or count' });
    }

    // Extract base name and start number from the input 'name'
    const nameParts = name.split(" ");
    let startNumber = parseInt(nameParts[nameParts.length - 1]);
    let baseName = nameParts.slice(0, nameParts.length - 1).join(" ");
    
    // If last part is not a valid number, treat entire name as base and start from 1
    if (isNaN(startNumber)) {
      startNumber = 1;
      baseName = name;
    }
    
    console.log(`Starting group creation: Base name "${baseName}", Starting from ${startNumber}, Count: ${count}`);

    const sock = whatsapp.getSock(userId);
    if (!sock) {
      return res.status(500).json({ error: 'WhatsApp not connected for this user' });
    }

    const links = [];
    const failedGroups = [];

    // Send immediate response with progress tracking
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send start notification
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
        // Check if connection is still active
        const currentSock = whatsapp.getSock(userId);
        if (!currentSock || !currentSock.user) {
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

        // Create empty group (no participants)
        const group = await currentSock.groupCreate(groupName, []);
        console.log(`✅ Group "${groupName}" created with ID: ${group.id}`);

        // Wait 3 seconds before configuring settings
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Configure group settings automatically
        let addMembersWarning = false;
        try {
          const settingSock = whatsapp.getSock(userId);
          if (settingSock && settingSock.user) {
            // 1. Allow all members to edit group info
            await settingSock.groupSettingUpdate(group.id, 'unlocked');
            console.log(`✅ Setting 1: Enabled group info editing for all members in ${groupName}`);
            
            // Small delay between settings
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 2. Allow all members to send messages
            await settingSock.groupSettingUpdate(group.id, 'not_announcement');
            console.log(`✅ Setting 2: Enabled messaging for all members in ${groupName}`);
            
            // Small delay between settings
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 3. Allow all members to add other members
            try {
              await settingSock.groupSettingUpdate(group.id, 'unlocked');
              console.log(`✅ Setting 3: Enabled member addition for all members in ${groupName}`);
            } catch (addMemberError) {
              console.log(`⚠️ Could not enable member addition for ${groupName}:`, addMemberError.message);
              addMembersWarning = true;
            }
          }
        } catch (settingsError) {
          console.log(`⚠️ Warning: Could not configure all settings for ${groupName}:`, settingsError.message);
          addMembersWarning = true;
        }

        // Set group description if provided
        if (groupDescription) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'description',
              action: 'setting',
              groupName: groupName,
              description: groupDescription,
              message: `Setting description for ${groupName}...`
            })}\n\n`);

            const descSock = whatsapp.getSock(userId);
            if (descSock && descSock.user) {
              await descSock.groupUpdateDescription(group.id, groupDescription);
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
          
          // Small delay after description
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Set group profile picture if provided
        if (groupImage) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'image',
              action: 'setting',
              groupName: groupName,
              imageName: groupImageName || 'uploaded image',
              message: `Setting profile picture for ${groupName}...`
            })}\n\n`);

            const imgSock = whatsapp.getSock(userId);
            if (imgSock && imgSock.user) {
              // Convert base64 to buffer
              const base64Data = groupImage.replace(/^data:image\/[a-z]+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              
              await imgSock.updateProfilePicture(group.id, buffer);
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
          
          // Small delay after image
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Wait 2 seconds before getting invite code
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get invite code
        let inviteCode;
        try {
          const activeSock = whatsapp.getSock(userId);
          if (activeSock && activeSock.user) {
            inviteCode = await activeSock.groupInviteCode(group.id);
          }
        } catch (inviteError) {
          console.log(`❌ Failed to get invite code for ${groupName}:`, inviteError.message);
        }

        if (inviteCode) {
          const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
          links.push({
            groupName,
            link: inviteLink,
            groupId: group.id
          });
          console.log(`✅ Invite link generated for ${groupName}`);

          // Add admin to group if adminNumber is provided
          let adminStatus = null;
          if (adminNumber && adminNumber.trim()) {
            try {
              console.log(`🔄 Adding admin ${adminNumber} to ${groupName}...`);
              
              // Send admin addition start notification
              res.write(`data: ${JSON.stringify({
                type: 'admin',
                action: 'adding',
                groupName: groupName,
                adminNumber: adminNumber,
                message: `Adding admin ${adminNumber} to ${groupName}...`
              })}\n\n`);

              const adminSock = whatsapp.getSock(userId);
              if (adminSock && adminSock.user) {
                adminStatus = await addAdminToGroup(adminSock, group.id, groupName, adminNumber, inviteLink);
                
                // Send admin addition result notification
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
              
              // Send error notification
              res.write(`data: ${JSON.stringify({
                type: 'admin',
                action: 'error',
                groupName: groupName,
                adminNumber: adminNumber,
                message: `Failed to add admin to ${groupName}: ${adminError.message}`
              })}\n\n`);
            }
          }

          // Send link with admin status
          res.write(`data: ${JSON.stringify({
            type: 'link',
            groupName: groupName,
            link: inviteLink,
            groupId: group.id,
            current: i + 1,
            total: count,
            addMembersWarning: addMembersWarning,
            adminStatus: adminStatus
          })}\n\n`);
        } else {
          failedGroups.push(groupName);
          console.log(`❌ Failed to get invite code for ${groupName}`);

          // Send failure notification
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

        // Send failure notification
        res.write(`data: ${JSON.stringify({
          type: 'failed',
          groupName: groupName,
          current: i + 1,
          total: count,
          reason: error.message
        })}\n\n`);
      }

      // Wait exactly 10 seconds before next group (except for the last group)
      if (i < count - 1) {
        console.log(`⏳ Waiting 10 seconds before next group...`);

        // Send wait notification
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

    // Create text file with all links
    if (links.length > 0) {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${baseName.replace(/\s+/g, '_')}_${timestamp}.txt`;
        const filepath = `./generated_links/${filename}`;
        
        // Ensure directory exists
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

    // Send final summary
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
};
