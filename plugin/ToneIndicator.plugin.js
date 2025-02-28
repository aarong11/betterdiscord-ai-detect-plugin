/**
 * @name ToneIndicator
 * @version 1.0.0
 * @description Appends tone indicators to Discord messages after analyzing their content.
 * (Modified from MessageScanAI by Aaron Goulden)
 * @author YourName
 */

module.exports = class ToneIndicator {
    
    constructor() {
      this.styleId = "ToneIndicatorStyles";
      this.processedMessages = new Set(); // Track processed messages to avoid duplicates
      this.messageTones = new Map(); // Store tone information for each message
      this.userMessages = new Map(); // Store recent messages by user ID
      this.maxUserMessages = 10; // Maximum number of messages to store per user
      this.currentChannelId = null; // Track the current channel
      this.messagesToProcessPerBatch = 5; // Number of messages to process in a batch
      this.processingBatch = false; // Flag to prevent multiple batch processes
      this.localStorageKey = 'ToneIndicator_Classifications'; // Key for localStorage
    }
  
    start() {
      // Inject CSS to style our custom text element.
      BdApi.injectCSS(this.styleId, `
        .custom-text {
          float: right;
          color: grey;
          font-style: italic;
          font-size: 12px;
          margin-left: 10px;
        }
        
        .tone-human {
          color: #43b581;
        }
        
        .tone-machine {
          color: #f04747;
        }
        
        .tone-polished {
          color: #faa61a;
        }
        
        .tone-humanized {
          color: #99aab5;
        }
      `);
      
      // Load saved classifications from localStorage
      this.loadClassificationsFromStorage();
      
      this.initialize();
    }
  
    initialize() {
      // Load Discord modules using BetterDiscord's Webpack interface.
      this.modules = {
        msg: BdApi.Webpack.getByKeys("replyIcon", "buttonContainer", "messageContent"),
        aside: BdApi.Webpack.getByKeys("appAsidePanelWrapper", "notAppAsidePanel", "app"),
      };
      
      // Find Discord's Flux dispatcher (the message event system)
      this.FluxDispatcher = BdApi.Webpack.getModule(m => m?.dispatch && m?.subscribe);
      
      if (this.FluxDispatcher) {
        // Hook into the MESSAGE_CREATE event
        this.messageCreateCallback = this.handleNewMessage.bind(this);
        this.FluxDispatcher.subscribe("MESSAGE_CREATE", this.messageCreateCallback);
        
        // Hook into channel switch events
        this.channelSelectCallback = this.handleChannelSwitch.bind(this);
        this.FluxDispatcher.subscribe("CHANNEL_SELECT", this.channelSelectCallback);
        
        console.log("[ToneIndicator] Successfully hooked into Discord's message system");
      } else {
        console.error("[ToneIndicator] Failed to find FluxDispatcher");
      }

      // Inject our custom text into existing messages.
      this.injectCustomText();
      
      // Process visible messages in the current channel
      this.processCurrentChannelMessages();
      
      // Still use MutationObserver for attaching tone indicators
      this.messageObserver = new MutationObserver((mutations) => {
        this.injectCustomText();
        
        // Check for newly rendered messages that need processing
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            this.checkForNewUnprocessedMessages();
          }
        }
      });

      const asideApp = document.querySelector(`.${this.modules.aside.app}`);
      if (asideApp) {
        this.messageObserver.observe(asideApp, {
          childList: true,
          subtree: true,
        });
      }
    }
    
    // Save classifications to localStorage
    saveClassificationsToStorage() {
      try {
        const data = {};
        for (const [messageId, classData] of this.messageTones.entries()) {
          data[messageId] = classData;
        }
        localStorage.setItem(this.localStorageKey, JSON.stringify(data));
        console.log("[ToneIndicator] Saved classifications to localStorage");
      } catch (error) {
        console.error("[ToneIndicator] Failed to save to localStorage:", error);
      }
    }
    
    // Load classifications from localStorage
    loadClassificationsFromStorage() {
      try {
        const savedData = localStorage.getItem(this.localStorageKey);
        if (savedData) {
          const data = JSON.parse(savedData);
          for (const [messageId, classData] of Object.entries(data)) {
            this.messageTones.set(messageId, classData);
          }
          console.log(`[ToneIndicator] Loaded ${Object.keys(data).length} classifications from localStorage`);
        }
      } catch (error) {
        console.error("[ToneIndicator] Failed to load from localStorage:", error);
      }
    }
    
    // Handle channel switch events
    handleChannelSwitch(data) {
      if (!data || !data.channelId) return;
      
      const newChannelId = data.channelId;
      if (this.currentChannelId !== newChannelId) {
        console.log(`[ToneIndicator] Channel switched from ${this.currentChannelId} to ${newChannelId}`);
        this.currentChannelId = newChannelId;
        
        // Wait a bit for Discord to render messages
        setTimeout(() => {
          this.processCurrentChannelMessages();
        }, 1000);
      }
    }
    
    // Process visible messages in the current channel
    async processCurrentChannelMessages() {
      if (this.processingBatch) return;
      
      this.processingBatch = true;
      console.log("[ToneIndicator] Processing visible messages in current channel");
      
      try {
        // Get all visible message elements
        const messageElements = document.querySelectorAll('[id^="chat-messages-"]');
        const messageIds = [];
        const unprocessedMessageElements = [];
        
        // Collect visible message IDs and elements that haven't been processed
        for (const element of messageElements) {
          const messageId = element.id.replace('chat-messages-', '');
          messageIds.push(messageId);
          
          if (!this.processedMessages.has(messageId) && !this.messageTones.has(messageId)) {
            unprocessedMessageElements.push({
              id: messageId,
              element: element
            });
          }
        }
        
        console.log(`[ToneIndicator] Found ${messageIds.length} visible messages, ${unprocessedMessageElements.length} unprocessed`);
        
        // Apply existing classifications
        this.injectCustomText();
        
        // Process unprocessed messages in batches
        if (unprocessedMessageElements.length > 0) {
          // Sort by position in the DOM (oldest first)
          unprocessedMessageElements.sort((a, b) => {
            const posA = a.element.getBoundingClientRect().top;
            const posB = b.element.getBoundingClientRect().top;
            return posA - posB;
          });
          
          // Take up to 50 messages to process
          const messagesToProcess = unprocessedMessageElements.slice(0, 50);
          console.log(`[ToneIndicator] Processing batch of ${messagesToProcess.length} messages`);
          
          // Process in smaller batches to avoid overloading
          for (let i = 0; i < messagesToProcess.length; i += this.messagesToProcessPerBatch) {
            const batch = messagesToProcess.slice(i, i + this.messagesToProcessPerBatch);
            await Promise.all(batch.map(item => this.processExistingMessage(item.id)));
            
            // Apply classifications after each batch
            this.injectCustomText();
            
            // Small delay between batches
            if (i + this.messagesToProcessPerBatch < messagesToProcess.length) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
      } catch (error) {
        console.error("[ToneIndicator] Error processing channel messages:", error);
      } finally {
        this.processingBatch = false;
      }
    }
    
    // Process a single existing message
    async processExistingMessage(messageId) {
      // If already processed or being processed, skip
      if (this.processedMessages.has(messageId)) return;
      
      // Mark as being processed to avoid duplicate processing
      this.processedMessages.add(messageId);
      
      try {
        // Fetch message data from Discord's API
        const messageElement = this.findMessageElement(messageId);
        if (!messageElement) return;
        
        // Extract content and author information
        const contentElement = messageElement.querySelector(`.${this.modules.msg.messageContent}`);
        if (!contentElement) return;
        
        const content = contentElement.textContent;
        
        // Try to extract author ID from DOM
        const authorElement = messageElement.querySelector('[data-author-id]');
        let authorId = authorElement ? authorElement.getAttribute('data-author-id') : null;
        
        // If we can't get the author ID from DOM, use a placeholder
        if (!authorId) {
          console.log(`[ToneIndicator] Couldn't get author ID for message ${messageId}`);
          return; // Skip messages where we can't identify the author
        }
        
        // Add this message to the user's history
        this.addUserMessage(authorId, content);
        
        // Get the user's recent messages
        const recentMessages = this.getRecentUserMessages(authorId);
        
        // Format the request for the classifier endpoint
        const classifierRequest = {
          text: recentMessages
        };
        
        // Make the request to the classifier endpoint
        const classifierResponse = await fetch(`http://127.0.0.1:3000/messages/classifier`, {
          method: "POST",
          body: JSON.stringify(classifierRequest),
          headers: {
            "Content-Type": "application/json",
          },
        });
        
        if (classifierResponse && classifierResponse.ok) {
          const classifierData = await classifierResponse.json();
          
          if (classifierData && classifierData[0]) {
            const classification = classifierData[0].label;
            const score = classifierData[0].score.toFixed(2);
            
            this.messageTones.set(messageId, {
              type: classification,
              score: score,
              display: `${classification} (${score})`
            });
            
            // Save to localStorage after each successful classification
            this.saveClassificationsToStorage();
          }
        }
      } catch (error) {
        console.error(`[ToneIndicator] Error processing existing message ${messageId}:`, error);
      }
    }
    
    // Check for newly rendered messages that need processing
    checkForNewUnprocessedMessages() {
      // Only run if we're not already processing a batch
      if (this.processingBatch) return;
      
      const messageElements = document.querySelectorAll('[id^="chat-messages-"]');
      const unprocessedMessageIds = [];
      
      for (const element of messageElements) {
        const messageId = element.id.replace('chat-messages-', '');
        if (!this.processedMessages.has(messageId) && !this.messageTones.has(messageId)) {
          unprocessedMessageIds.push(messageId);
        }
      }
      
      if (unprocessedMessageIds.length > 0) {
        console.log(`[ToneIndicator] Found ${unprocessedMessageIds.length} new unprocessed messages`);
        this.processCurrentChannelMessages();
      }
    }
    
    // Helper method to add a message to the user's recent messages list
    addUserMessage(userId, content) {
      if (!userId || !content) return;
      
      if (!this.userMessages.has(userId)) {
        this.userMessages.set(userId, []);
      }
      
      const userMsgs = this.userMessages.get(userId);
      userMsgs.push(content);
      
      // Keep only the latest messages (up to maxUserMessages)
      if (userMsgs.length > this.maxUserMessages) {
        userMsgs.shift(); // Remove the oldest message
      }
      
      this.userMessages.set(userId, userMsgs);
    }
    
    // Helper method to get recent messages for a user
    getRecentUserMessages(userId) {
      return this.userMessages.get(userId) || [];
    }
    
    async handleNewMessage(message) {
      // This gets raw message data directly from Discord
      const messageData = message.message;
      if (!messageData || !messageData.content) return;
      
      const messageId = messageData.id;
      const content = messageData.content;
      const author = messageData.author;
      const authorId = author?.id;
      const channelId = message.channelId;

      // Skip if we've already processed this message
      if (this.processedMessages.has(messageId)) return;
      this.processedMessages.add(messageId);

      console.log(`Message ID: ${messageId} - From: ${author?.username} in channel: ${channelId}`);
      
      // Store this message in the user's message history
      this.addUserMessage(authorId, content);

      try {
        // First register the message
        await fetch(`http://localhost:3000/messages`, {
          method: "POST",
          body: JSON.stringify(message),
          headers: {
            "Content-Type": "application/json",
          },
        });
        
        // Get the user's last messages
        const recentMessages = this.getRecentUserMessages(authorId);
        
        // Format the request for the classifier endpoint
        const classifierRequest = {
          text: recentMessages
        };
        
        console.log("Sending to classifier:", classifierRequest);
        
        // Make the request to the classifier endpoint
        const classifierResponse = await fetch(`http://127.0.0.1:3000/messages/classifier`, {
          method: "POST",
          body: JSON.stringify(classifierRequest),
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (classifierResponse && classifierResponse.ok) {
          const classifierData = await classifierResponse.json();
          console.log("Classifier response:", classifierData);
          
          if (classifierData && classifierData[0]) {
            const classification = classifierData[0].label;
            const score = classifierData[0].score.toFixed(2);
            const result = `${classification} (${score})`;
            
            console.log(`Classification for message ${messageId}: ${result}`);
            
            this.messageTones.set(messageId, {
              type: classification,
              score: score,
              display: result
            });
            
            // Save to localStorage
            this.saveClassificationsToStorage();
            
            // Try to update the message immediately if it's already rendered
            this.updateMessageClassification(messageId, classification, score);
          } else {
            console.log("No classification data found in response");
          }
        } else {
          console.error("Classification request failed:", classifierResponse?.status, classifierResponse?.statusText);
        }
      } catch (error) {
        console.error("[ToneIndicator] Error processing message:", error);
      }
    }
    
    // Helper method to find a message element by its ID
    findMessageElement(messageId) {
      // This approach uses message-accessories which is where the timestamp is shown
      // The parent element would be the message container
      const messageElements = document.querySelectorAll('[id^="message-accessories-"]');
      for (const element of messageElements) {
        if (element.id === `message-accessories-${messageId}`) {
          return element.closest('[id^="chat-messages-"]');
        }
      }
      return null;
    }
    
    // Update the message with classification
    updateMessageClassification(messageId, classification, score) {
      console.log(`Updating classification for message ${messageId} to: ${classification}`);
      const messageElement = this.findMessageElement(messageId);
      if (!messageElement) {
        console.log(`Message element not found for ID: ${messageId}`);
        return;
      }
      
      const messageContent = messageElement.querySelector(`.${this.modules.msg.messageContent}`);
      if (!messageContent) {
        console.log(`Message content element not found for ID: ${messageId}`);
        return;
      }
      
      // Remove any existing indicator
      const existingIndicator = messageContent.querySelector(".custom-text");
      if (existingIndicator) existingIndicator.remove();
      
      // Add the new indicator with the specific class based on classification
      let toneClass = "tone-human";
      switch (classification) {
        case "HUMAN_WRITTEN":
          toneClass = "tone-human";
          break;
        case "MACHINE_GENERATED":
          toneClass = "tone-machine";
          break;
        case "HUMAN_WRITTEN_MACHINE_POLISHED":
          toneClass = "tone-polished";
          break;
        case "MACHINE_WRITTEN_MACHINE_HUMANIZED":
          toneClass = "tone-humanized";
          break;
      }
      
      messageContent.insertAdjacentHTML(
        "beforeend", 
        `<span class="custom-text ${toneClass}">${classification} (${score})</span>`
      );
      console.log(`Classification indicator added for message ${messageId}`);
    }
    
    // Update the injectCustomText method to handle classification data
    injectCustomText() {
      // Find every message content element
      document.querySelectorAll(`.${this.modules.msg.messageContent}`).forEach(messageContent => {
        // Find the message container to extract the ID
        const messageContainer = messageContent.closest('[id^="chat-messages-"]');
        if (!messageContainer) return;
        
        // Extract message ID from the container
        const messageId = messageContainer.id.replace('chat-messages-', '');
        
        // Check if we have classification data for this message
        const classData = this.messageTones.get(messageId);
        
        // Get existing indicator if any
        const existingIndicator = messageContent.querySelector(".custom-text");
        
        if (classData) {
          // We have data for this message
          const classification = classData.type;
          const score = classData.score;
          
          let toneClass = "tone-human";
          switch (classification) {
            case "HUMAN_WRITTEN":
              toneClass = "tone-human";
              break;
            case "MACHINE_GENERATED":
              toneClass = "tone-machine";
              break;
            case "HUMAN_WRITTEN_MACHINE_POLISHED":
              toneClass = "tone-polished";
              break;
            case "MACHINE_WRITTEN_MACHINE_HUMANIZED":
              toneClass = "tone-humanized";
              break;
          }
          
          if (existingIndicator) {
            // Update existing indicator if needed
            if (!existingIndicator.classList.contains(toneClass) || 
                !existingIndicator.textContent.includes(classification)) {
              existingIndicator.className = `custom-text ${toneClass}`;
              existingIndicator.textContent = `${classification} (${score})`;
            }
          } else {
            // Create new indicator if none exists
            messageContent.insertAdjacentHTML(
              "beforeend", 
              `<span class="custom-text ${toneClass}">${classification} (${score})</span>`
            );
          }
        } else if (!existingIndicator) {
          // No data yet and no indicator, show analyzing state
          messageContent.insertAdjacentHTML(
            "beforeend", 
            `<span class="custom-text"></span>`
          );
        }
      });
    }

    stop() {
      // Disconnect the MutationObserver.
      if (this.messageObserver) {
        this.messageObserver.disconnect();
      }
      
      // Unsubscribe from the message events
      if (this.FluxDispatcher) {
        if (this.messageCreateCallback) {
          this.FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.messageCreateCallback);
        }
        if (this.channelSelectCallback) {
          this.FluxDispatcher.unsubscribe("CHANNEL_SELECT", this.channelSelectCallback);
        }
      }
      
      // Remove our injected CSS.
      BdApi.clearCSS(this.styleId);
      
      // Remove any custom text elements we've added.
      document.querySelectorAll(".custom-text").forEach(elem => elem.remove());
      
      // Clear stored data
      this.messageTones.clear();
      this.processedMessages.clear();
      this.userMessages.clear();
    }
  };