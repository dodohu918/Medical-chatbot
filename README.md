# Medical Chatbot Backend
### For real chatbot workflow demostration, please check out the "Chatbot demonstration" folder
This repository contains several iterations of a Node.js chatbot that assists patients in selecting the right clinic. Each folder named `ver X.` stores a snapshot of the backend at that stage.

## Repository Layout

| Path | Description |
| ---- | ----------- |
| `App_ver1.js` | Early React frontend demonstrating how to post messages to the backend. |
| `Index.css` | Simple global styles used by the React examples. |
| `flow_base_before_find_clinic.json` | Prototype flow chart before clinic lookup was implemented. |
| `ver 2.` | Contains `App_ver2.js` and `server_ver2.js` with improved styling and symptom classification. |
| `ver 3.` | Adds email summaries and clinic links using `server.js` and `flow_base.json`. |
| `ver 4.` | Loads all flow files automatically and supports `{{SYMPTOM}}` replacement. |
| `ver 5.` | Introduces configurable classification rules via JSON. |
| `ver 6.` | Extends classification with synonyms and collects past medical history. Includes `classification_rules.json`. |
| `ver 7.` | Demonstrates Firebase logging (see folder README). |
| `ver 8.` | Writes chat logs to Firestore for later BigQuery use. |
| `ver 9.` | Prototype Supabase integration with notes in the folder README. |

## Example Code Snippets

### Posting Messages from the Frontend
```javascript
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
```

### Styling
```css
body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background-color: rgb(7, 6, 6);
    color: white;
  }
  
  code {
    font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
      monospace;
  }```

### Email Summary Logic
```javascript

    case "function": {
      const handlerName = node.handler;
      if (handlerName === "classifySymptomHandler") {
        // 1) Do classification
        const nextNodeId = await classifySymptomHandler(userMessage);

        // 2) Immediately fetch the *next* node’s question
        const nextNode = getNode(nextNodeId) || {};
        const nextQuestion = nextNode.question || "";

        return [nextNodeId, nextQuestion];
      } else {
        return ["end", "該功能無法使用。"];
      }
    }

    case "open-ended": {
      // SPECIAL CASE: If the node is "get_email", we gather conversation, summarize, and email
      if (currentNodeId === "get_email") {
        // The userMessage here is the user's email.
        const userEmail = userMessage;

        // 1) Store in conversation state if needed
        conversationState[user_id].email = userEmail;

        // 2) Build the conversation text so far
        let conversationText = "";
        const answersObj = conversationState[user_id].answers || {};
        for (const nodeId of Object.keys(answersObj)) {
          const { question, answer } = answersObj[nodeId];
          conversationText += `Q: ${question}\nA: ${answer}\n\n`;
        }

        // 3) Summarize the conversation with OpenAI
        const summary = await summarizeConversation(conversationText);

        // 4) Send the summarized text to the user
        await sendEmailToUser(userEmail, summary).catch((err) =>
          console.error("sendEmailToUser error:", err)
        );

        // 5) Move on to the next node (should be "end" in your flow_base.json)
        const nextNodeId = node.next || "end";
        return [nextNodeId, botReply];
      }

      // If it's the get_age node, validate integer
      if (currentNodeId === "get_age") {
        const age = parseInt(userMessage.trim(), 10);

        // If parsing failed or age is not in a sensible range, re-ask
        if (isNaN(age) || age < 0 || age > 120) {
          // Remain on the same node, override botReply with an error
          return [currentNodeId, "請輸入有效的年齡（0~120）"];
        } else {
          // Store the valid age in your conversation state if desired
          // Then move to the next node
          const nextNodeId = node.next || "end";
          const nextNode = getNode(nextNodeId) || {};
          const nextQuestion = nextNode.question || "";
          return [nextNodeId, nextQuestion];
        }
      }
```

### Classification Rules
```json
{
    "categories": [
      {
        "label": "abdominal pain",
        "trigger": "abdominal",         
        "node": "abdomen_start",
        "synonyms": ["肚子痛", "胃痛", "腹痛", "消化不良導致的痛"]
      },
      {
        "label": "joint pain",
        "trigger": "joint pain",
        "node": "joint_start"
      },
      {
        "label": "numbness feeling or tingling feeling over legs",
        "trigger": "numbness feeling or tingling feeling over legs",
        "node": "RLS_start"
      },
```
```

Below are some demonstration of the chatbot
<img width="856" alt="image" src="https://github.com/user-attachments/assets/f214678c-1954-4908-9590-970a55f9ec67" />
<img width="877" alt="image" src="https://github.com/user-attachments/assets/8a162d80-bb2e-4474-b308-a9efe5b26ffc" />
<img width="864" alt="image" src="https://github.com/user-attachments/assets/77540bae-8245-4055-87e0-d9894e3d0b87" />

