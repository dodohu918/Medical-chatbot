import React, { useState, useEffect } from 'react';

function Chatbot() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [userId, setUserId] = useState("");  // We'll get this from the server

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

    // Save the user's message and clear the input
    const userMessage = inputValue.trim();
    const newMessages = [...messages, { sender: "user", text: userMessage }];
    setMessages(newMessages);
    setInputValue("");

    try {
      // Prepare the payload for the backend
      const payload = {
        user_id: userId,
        message: userMessage
      };

      // Send the user's message to the Node backend
      const response = await fetch("http://localhost:3000/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      // Parse the response
      const data = await response.json();
      console.log("Bot says:", data.response);

      // Add the bot's reply to the chat
      setMessages([...newMessages, { sender: "bot", text: data.response }]);

    } catch (error) {
      console.error(error);
      // Optional: show an error message in the UI
    }
  }

  return (
    <div style={{ width: '400px', margin: '50px auto', textAlign: 'center' }}>
      <h1>Chatbot</h1>
      <div
        style={{
          border: '1px solid #ccc',
          padding: '10px',
          height: '300px',
          overflowY: 'auto',
          marginBottom: '10px'
        }}
      >
        {messages.map((msg, idx) => (
          <p key={idx}>
            <strong>{msg.sender === "user" ? "您:" : "機器人:"}</strong> {msg.text}
          </p>
        ))}
      </div>
      <input
        style={{ width: '70%' }}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyPress={(e) => {
          if (e.key === "Enter") {
            sendMessage();
          }
        }}
      />
      <button onClick={sendMessage}>送出</button>
    </div>
  );
}

export default Chatbot;
