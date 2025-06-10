// Version 4.0
// Add image into chat bubble

import React, { useState, useEffect } from 'react';
import './index.css';  // Make sure to import your CSS here!

function Chatbot() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [userId, setUserId] = useState("");
  
  useEffect(() => {
    initChat();
  }, []);

  async function initChat() {
    try {
      // Call the GET /chatbot/start endpoint
      const res = await fetch("http://localhost:3000/chatbot/start");
      const data = await res.json();

      // data = { user_id: "...", greeting: "您好！..." }
      setUserId(data.user_id);

      // Show the bot's greeting as the initial message
      setMessages([{ sender: "bot", text: data.greeting }]);
    } catch (error) {
      console.error("Error calling /chatbot/start:", error);
    }
  }

  async function sendMessage() {
    // If the input is empty, do nothing
    if (!inputValue.trim()) return;

    const userMessage = inputValue.trim();
    // Add user message to the chat
    setMessages((prev) => [...prev, { sender: "user", text: userMessage }]);
    setInputValue("");

    try {
      // Prepare the payload for the backend
      const payload = {
        user_id: userId,
        message: userMessage,
      };

      // Send the user's message to the Node backend
      const response = await fetch("http://localhost:3000/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Parse the response
      const data = await response.json();
      console.log("Bot says:", data.response);

      // Add the bot's reply to the chat
      setMessages((prev) => [...prev, { 
        sender: "bot", 
        text: data.response,
        image: data.image || null
      }]);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <h1 className="chat-header">默友輔助找診所</h1>
  
      {/* Message list */}
      <div className="chat-window">
        {messages.map((msg, idx) => {
          if (msg.sender === "bot") {
            // BOT MESSAGES => render HTML
            return (
              <div key={idx} className="message bot">
                <p 
                  className="message-text" 
                  dangerouslySetInnerHTML={{ __html: `<strong>機器人:</strong> ${msg.text}` }}
                />
              </div>
            );
          } else {
            // USER MESSAGES => plain text
            return (
              <div key={idx} className="message user">
                <p className="message-text">
                  <strong>您:</strong> {msg.text}
                </p>
              </div>
            );
          }
        })}
      </div>
  
      {/* Input area */}
      <div className="chat-input-area">
        <input
          className="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              sendMessage();
            }
          }}
        />
        <button className="send-button" onClick={sendMessage}>
          送出
        </button>
      </div>
    </div>
  );
  
}

export default Chatbot;
