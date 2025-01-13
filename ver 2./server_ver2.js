require("dotenv").config(); 

console.log("ENV OPENAI_API_KEY:", process.env.OPENAI_API_KEY);

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { Configuration, OpenAIApi } = require("openai");

// --- INITIALIZE APP ---
const app = express();
app.use(cors());
app.use(express.json());

// --- LOAD FLOW JSON ---
// --- LOAD FLOW JSON FILES ---
const flowBaseData    = fs.readFileSync("flows/flow_base.json", "utf8");
const flowAbdomenData = fs.readFileSync("flows/flow_abdomen.json", "utf8");
const flowJointData   = fs.readFileSync("flows/flow_joint.json", "utf8");

// Parse them into objects
const flowBase    = JSON.parse(flowBaseData);
const flowAbdomen = JSON.parse(flowAbdomenData);
const flowJoint   = JSON.parse(flowJointData);

// Merge them together
// We assume they all share the same structure: { nodes: { ... } }
const flow = {
  nodes: {
    ...flowBase.nodes,
    ...flowAbdomen.nodes,
    ...flowJoint.nodes,
  }
};

console.log("Merged flow has nodes:", Object.keys(flow.nodes));


// --- CONVERSATION STATE ---
const conversationState = {};

// --- CONFIGURE OPENAI ---
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Retrieve a node from the flow chart
function getNode(nodeId) {
  return flow.nodes[nodeId];
}

// Classification function example
async function classifySymptomHandler(userInput) {
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful medical triage assistant. Your job is to read a user's symptom description " +
        "and classify it into one of the following categories:\n\n" +
        "1) 'abdominal pain'\n" +
        "2) 'joint pain'\n" +
        "3) 'other'\n\n" +
        "Return ONLY the most relevant category name: 'abdominal pain', 'joint pain', or 'other'. " +
        "No extra text. No disclaimers."
    },
    {
      role: "user",
      content: `Symptom description: ${userInput}`
    }
  ];

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0
    });

    console.log("OpenAI raw response:", response.data);

    const chatgptReply = response.data.choices[0].message.content.trim().toLowerCase();
    console.log("GPT reply classification:", chatgptReply);

    if (chatgptReply.includes("abdominal")) {
      return "abdomen_start";
    } else if (chatgptReply.includes("joint")) {
      return "joint_start";
    } else {
      return "abdomen_start"; // default fallback
    }
  } catch (err) {
    console.error("OpenAI API error:", err);
    return "abdomen_start"; // fallback on error
  }
}

/**
 * askQuestion: main logic for node transitions
 * Returns [ nextNodeId, botReply ] so we can show 
 * the *new* node’s question in one shot.
 */
async function askQuestion(currentNodeId, userMessage = "") {
  const node = getNode(currentNodeId);
  if (!node) {
    // Node not found => end
    return ["end", "抱歉，我無法處理您的請求，請稍後再試。"];
  }

  console.log("askQuestion -> node:", currentNodeId, "type:", node.type);

  // Usually we start with the current node’s question
  let botReply = node.question || "";

  switch (node.type) {
    case "end":
      // Terminal node 
      return ["end", botReply];

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
      // Special handling: if this *is* the greeting node and we do have user input,
      // auto-skip to next, but carry the same userMessage forward
      if (currentNodeId === "greeting" && userMessage.trim()) {
        // Move to greeting’s `next` node right away
        const nextNodeId = node.next || "end";
    
        // Instead of just returning [nextNodeId, nextQuestion],
        // we call askQuestion again so the userMessage is passed on:
        return await askQuestion(nextNodeId, userMessage);
    
      } else {
        // For other open-ended nodes, or if user typed nothing, return as normal
        return [currentNodeId, botReply];
      }
    }

    case "yes_no": {
      // A yes/no question. If user says “是”, go nextIfYes; “否”, nextIfNo
      const yesList = ["yes", "y", "是", "1",];
      const noList  = ["no",  "n", "否", "2"];
      const lowerMsg = userMessage.toLowerCase();

      if (yesList.includes(lowerMsg)) {
        const nextNodeId = node.nextIfYes || "end";
        // Immediately fetch that node’s question:
        const nextNode = getNode(nextNodeId) || {};
        const nextQuestion = nextNode.question || "";
        return [nextNodeId, nextQuestion];
      } else if (noList.includes(lowerMsg)) {
        const nextNodeId = node.nextIfNo || "end";
        const nextNode = getNode(nextNodeId) || {};
        const nextQuestion = nextNode.question || "";
        return [nextNodeId, nextQuestion];
      } else {
        // Invalid => remain on same node, give fallback
        return [currentNodeId, "請回答是或否。"];
      }
    }

    case "multiple_choice": {
      // Expect user to match one of the 'options' (like ["localized", "diffuse"] or ["1", "2"])
      const lowerMsg = userMessage.toLowerCase();
      if (node.options && node.options.includes(lowerMsg)) {
        const chosenOption = lowerMsg; 
        // Get the "label" from optionLabels if it exists
        const chosenLabel = node.optionLabels && node.optionLabels[chosenOption] 
                            ? node.optionLabels[chosenOption] 
                            : userMessage;  // fallback to what user typed

        const nextNodeId = node.next[lowerMsg];
        const nextNode = getNode(nextNodeId) || {};
        const nextQuestion = nextNode.question || "";
        return [nextNodeId, nextQuestion, chosenLabel];
      } else {
        // Invalid => remain on same node
        return [currentNodeId, "無效的選項，請選擇有效的選項。"];
      }
    }

    default:
      // Fallback
      return ["end", "感謝使用！"];
  }
}

// Telling ChatGPT to summarize the Q&A for me
async function summarizeConversation(conversationText) {
  const messages = [
    {
      role: "system",
      content: 
        "You are a helpful assistant that summarizes a Q&A conversation into a single coherent paragraph in Traditional Chinese. " +
        "Omit the final question '還有其他需要幫忙的嗎？' and its answer if present. " +
        "Do not include disclaimers. Output only the summarized text."
    },
    {
      role: "user",
      content: `
這是使用者與機器人之間的對話（問題與回答），請幫我簡化成一段文字：
${conversationText}
      `
    }
  ];

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0.7,
    });

    // Extract the assistant's reply
    const summarizedText = response.data.choices[0].message.content.trim();
    return summarizedText;
  } catch (error) {
    console.error("Error in summarizeConversation:", error);
    // Return some fallback text if the API fails
    return "（總結失敗，請稍後再試。）";
  }
}


// POST /chatbot
app.post("/chatbot", async (req, res) => {
  console.log("=== Received request in /chatbot ===", req.body);

  try {
    const { user_id, message } = req.body;
    if (!user_id) {
      return res.status(400).json({ response: "No user_id provided" });
    }

    // Initialize state if new user
    if (!conversationState[user_id]) {
      conversationState[user_id] = { 
        currentNode: "greeting",
        answers: {}
       };
    }

    const currentNode = conversationState[user_id].currentNode;
    const userMessage = message.trim().toLowerCase();

    // Move the flow
    const [nextNode, botReply, chosenLabel] = await askQuestion(currentNode, userMessage);

    // We can store both the question and the user’s label in answers.
    const node = getNode(currentNode);

    if (!conversationState[user_id].answers) {
      conversationState[user_id].answers = {};
    }

    // We'll store an object with both the question and the user's (friendly) answer
    conversationState[user_id].answers[currentNode] = {
      question: node.question, 
      answer: chosenLabel || userMessage
    };

    // Update user state
    conversationState[user_id].currentNode = nextNode;

    // At the end of the conversation:
    if (nextNode === "end") {
      const endNode = getNode("end");
      const answersObj = conversationState[user_id].answers || {};

      // Build the question-answer text block
      let conversationText = "";
      for (const nodeId of Object.keys(answersObj)) {
        const { question, answer } = answersObj[nodeId];
        conversationText += `Q: ${question}\nA: ${answer}\n\n`;
      }

      // Now let's call our new function to summarize the Q&A
      const summary = await summarizeConversation(conversationText);

      // Return the final message + the summary
      if (endNode && endNode.question) {
        return res.json({
          response: endNode.question + "\n\n" + "我們收集到以下您的狀況: " + summary
        });
      }
    }


    return res.json({ response: botReply });
  } catch (error) {
    console.error("Error in /chatbot:", error);
    return res.status(500).json({ response: "Internal server error." });
  }
});

app.get("/chatbot/start", (req, res) => {
  const user_id = "start_user_" + Date.now(); // simplistic example
  conversationState[user_id] = { currentNode: "greeting" };

  const greetingNode = flow.nodes["greeting"];
  const question = greetingNode?.question || "您好！";

  return res.json({
    user_id,
    greeting: question,
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Chatbot server running on http://localhost:${PORT}`);
});
