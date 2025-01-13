// Version 4.0
// Made the flow use the logic that was able to use the first line "您提到{{SYMPTOM}}"
// Compact the code to load all the flow json files

require("dotenv").config(); 

console.log("ENV OPENAI_API_KEY:", process.env.OPENAI_API_KEY);

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { Configuration, OpenAIApi } = require("openai");

// --- INITIALIZE APP ---
const app = express();
app.use(cors());
app.use(express.json());

// --- LOAD FLOW JSON FILES ---
// 1. Get all JSON filenames in the "flows" folder
const flowsFolderPath = path.join(__dirname, "flows");
const flowFiles = fs
  .readdirSync(flowsFolderPath)
  .filter((filename) => filename.endsWith(".json"));

// 2. Loop through each file, parse JSON, and merge "nodes"
let flow = { nodes: {} };

flowFiles.forEach((filename) => {
  const filePath = path.join(flowsFolderPath, filename);
  const fileData = fs.readFileSync(filePath, "utf8");
  const parsedFlow = JSON.parse(fileData);

  // Make sure we correctly spread the correct key. 
  // (Assuming they all have "nodes"—adjust if yours differ.)
  if (parsedFlow.nodes) {
    flow.nodes = { ...flow.nodes, ...parsedFlow.nodes };
  }
});

// 3. Now "flow" contains all merged nodes
console.log("Merged flow has nodes:", Object.keys(flow.nodes));

// --- CONVERSATION STATE ---
const conversationState = {};

// --- CONFIGURE OPENAI ---
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Nodemailer transporter (example: Gmail + App Password or standard password)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,  // e.g. "myaccount@gmail.com"
    pass: process.env.GMAIL_PASS   // e.g. "abcxyz123" (App password recommended)
  }
});

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
        "3) 'numbness feeling or tingling feeling over legs'\n" +
        "4) 'neck mass'\n" +
        "5) 'lower back pain'\n"+
        "6) 'easy thirsty'\n"+
        "7) 'other'\n" +
        "Return ONLY the most relevant category name, exactly as it appears in the list above. " +
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
    } else if (chatgptReply.includes("neck mass")) {
      return "neck_mass_start";
    } else if (chatgptReply.includes("numbness feeling or tingling feeling over legs")) {
      return "RLS_start";
    } else if (chatgptReply.includes("lower back pain")) {
      return "lowerBackPain_start";
    } else if (chatgptReply.includes("easy thirsty")) {
      return "4_easyThirsty_start";
    }else {
      return "abdomen_start"; // default fallback
    }
  } catch (err) {
    console.error("OpenAI API error:", err);
    return "abdomen_start"; // fallback on error
  }
}

/**
 * askQuestion: main logic for node transitions
 * Returns [ nextNodeId, botReply, chosenLabel ] so we can show
 * the *new* node’s question in one shot.
 */
async function askQuestion(currentNodeId, userRawMessage = "", user_id = "", userLowerCase = "") {
  const node = getNode(currentNodeId);
  if (!node) {
    // Node not found => end
    return ["end", "抱歉，我無法處理您的請求，請稍後再試。"];
  }

  console.log("askQuestion -> node:", currentNodeId, "type:", node.type);

  // Usually we start with the current node’s question
  let botReply = node.question || "";

  // 1) Replace placeholder
  console.log("botReply (before):", botReply);
  if (botReply.includes("{{SYMPTOM}}")) {
    console.log("Replacing SYMPTOM...");
    botReply = botReply.replace("{{SYMPTOM}}", userRawMessage);
    console.log("botReply (after):", botReply);
  }

  // 2) If the node has a specialty in `meta`, store it in conversationState
  //    and append a hyperlink to `botReply`.
  if (node.meta && node.meta.specialty) {
    // Example: store in conversationState so we know the user’s chosen specialty
    conversationState[user_id].chosenSpecialty = node.meta.specialty;

    // Append hyperlink to the botReply:
    botReply += `\n\n【更多資訊】請參考: https://example.com/info?specialty=${encodeURIComponent(node.meta.specialty)}`;
  }

  switch (node.type) {
    case "end":
      // Terminal node 
      return ["end", botReply];

      case "function": {
        const handlerName = node.handler;
        if (handlerName === "classifySymptomHandler") {
          // 1) Classify the symptom
          const nextNodeId = await classifySymptomHandler(userRawMessage);
      
          // 2) Manually fetch the next node
          const nextNode = getNode(nextNodeId) || {};
      
          // 3) Build the nextQuestion from nextNode.question
          let nextQuestion = nextNode.question || "";
      
          // 4) If it has {{SYMPTOM}}, replace it here
          if (nextQuestion.includes("{{SYMPTOM}}")) {
            nextQuestion = nextQuestion.replace("{{SYMPTOM}}", userRawMessage);
          }
      
          // 5) Return just that text (instead of re‐invoking askQuestion)
          return [nextNodeId, nextQuestion];
        }
        else {
          return ["end", "該功能無法使用。"];
        }
      }
      

    case "open-ended": {
      // SPECIAL CASE: If the node is "get_email", we gather conversation, summarize, and email
      if (currentNodeId === "get_email") {
        // The userMessage here is the user's email.
        const userEmail = userRawMessage;

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
        const age = parseInt(userRawMessage.trim(), 10);

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

      // Another special handling: greeting node
      if (currentNodeId === "greeting" && userRawMessage.trim()) {
        // Move to greeting’s `next` node right away
        const nextNodeId = node.next || "end";
        return await askQuestion(nextNodeId, userRawMessage, user_id);
      } else {
        // For other open-ended nodes, or if user typed nothing, return as normal
        return [currentNodeId, botReply];
      }
    }

    case "yes_no": {
      // A yes/no question. If user says “是” or “1”, go nextIfYes; “否” or “2”, nextIfNo
      const yesList = ["yes", "y", "是", "1"];
      const noList  = ["no",  "n", "否", "2"];
      const lowerMsg = userRawMessage.toLowerCase();

      if (yesList.includes(userLowerCase)) {
        const nextNodeId = node.nextIfYes || "end";
        const nextNode = getNode(nextNodeId) || {};
        const nextQuestion = nextNode.question || "";
        return [nextNodeId, nextQuestion];
      } else if (noList.includes(userLowerCase)) {
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
      // Expect user to match one of the 'options' 
      // (like ["localized", "diffuse"] or ["1", "2"], etc.)
      const lowerMsg = userLowerCase; // pass from the route

      if (node.options && node.options.includes(lowerMsg)) {
        // valid choice
        const chosenLabel = node.optionLabels?.[lowerMsg] || userRawMessage;
        // If the current node is one of the "find_clinic_*" nodes, store the city
        if (["find_clinic_north", "find_clinic_mid", "find_clinic_south", "find_clinic_east", "find_clinic_out"].includes(currentNodeId)) {
          conversationState[user_id].selectedCity = chosenLabel;
        }
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

async function summarizeConversation(conversationText) {
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful assistant that reads a Q&A conversation in Chinese. " +
        "Summarize it in TWO parts: \n" +
        "1) A concise Chinese summary.\n" +
        "2) An admission-note–like summary (e.g., in the form like This is a xx-year-old male/female patient with past history of... and medication history of... He/She complaint of (chief complaint) for more than (duration) with ...(accompanied symptoms)), resembling a professional medical note.\n\n" +
        "Return your answer as valid JSON with the following keys exactly:\n" +
        "  {\n" +
        "    \"chinese_summary\": \"...\",\n" +
        "    \"admission_note\": \"...\"\n" +
        "  }\n\n" +
        "Do not include any extra text or disclaimers outside the JSON structure."
    },
    {
      role: "user",
      content: `
這是使用者與機器人之間的對話（問題與回答）：
${conversationText}

請根據上述內容，依照指示格式產生兩種摘要。`
    }
  ];

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      temperature: 0.7,
    });

    // The model should respond with a JSON string, e.g.:
    // {
    //   "chinese_summary": "...",
    //   "admission_note": "..."
    // }
    const rawContent = response.data.choices[0].message.content.trim();
    console.log("OpenAI raw summary:", rawContent);

    // Attempt to parse the JSON
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err) {
      console.error("Error parsing JSON from GPT:", err);
      parsed = {
        chinese_summary: "（無法解析）",
        admission_note: "（無法解析）"
      };
    }

    return parsed;
  } catch (error) {
    console.error("Error in summarizeConversation:", error);
    return {
      chinese_summary: "（總結失敗）",
      admission_note: "（總結失敗）"
    };
  }
}


/**
 * A helper function to send the email right away.
 * Now takes the summarized text as the email body.
 */
async function sendEmailToUser(userEmail, summarizedText) {
  const mailOptions = {
    from: process.env.GMAIL_USER,  // "sender"
    to: userEmail,
    subject: "這是您的醫療建議與診所資訊",
    text: JSON.stringify(summarizedText, null, 2)
  };
  // Actually send the email
  await transporter.sendMail(mailOptions);
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

    // 1) Keep both versions of the user’s message
    const userRawMessage = message.trim();         // Original text
    const userLowerCase  = userRawMessage.toLowerCase(); // For classification/matching

    const currentNode = conversationState[user_id].currentNode;

    // 2) Ask the question, but pass both the raw and lowercased text
    //    so you can handle placeholders + classification in askQuestion.
    const [nextNode, botReply, chosenLabel] = await askQuestion(
      currentNode, 
      userRawMessage,  // For placeholders, e.g., "{{SYMPTOM}}"
      user_id,
      userLowerCase    // For yes/no or multiple_choice matching
    );

    // We can store both the question and the user’s label in answers.
    const node = getNode(currentNode);

    if (!conversationState[user_id].answers) {
      conversationState[user_id].answers = {};
    }

    // We'll store an object with both the question and the user's (friendly) answer
    conversationState[user_id].answers[currentNode] = {
      question: node.question,
      answer: chosenLabel || userRawMessage
    };

    // Update user state
    conversationState[user_id].currentNode = nextNode;

    // At the end of the conversation:
    if (nextNode === "end") {
      const endNode = getNode("end");
      const answersObj = conversationState[user_id].answers || {};

      // Build the question-answer text block (for display or logging)
      let conversationText = "";
      for (const nodeId of Object.keys(answersObj)) {
        const { question, answer } = answersObj[nodeId];
        conversationText += `Q: ${question}\nA: ${answer}\n\n`;
      }

      // Summarize the conversation at the end as well (optional).
      // This is just for the final response if you want to show it in the chat.
      const summary = await summarizeConversation(conversationText);

        // Now summary is an object: { chinese_summary, admission_note }
      const { chinese_summary, admission_note } = summary;


      // Now build the final reply
      if (endNode && endNode.question) {
        // 1) Start with the endNode’s default question text
        let finalReply =
          endNode.question +
          "\n\n" +
          "【中文總結】" + chinese_summary +
          "\n\n" +
          "【Summary Note】" + admission_note;

        // 2) If a specialty was chosen, append a hyperlink
        const chosenSpec = conversationState[user_id].chosenSpecialty;
        const chosenCity = conversationState[user_id].selectedCity;

        // Only build the link if at least one is defined
        if (chosenSpec || chosenCity) {
          // Start building the URL
          let url = "https://example.com/info?";

          // If we have a specialty, append it
          if (chosenSpec) {
            url += `specialty=${encodeURIComponent(chosenSpec)}&`;
          }

          // If we have a city, append it
          if (chosenCity) {
            url += `city=${encodeURIComponent(chosenCity)}&`;
          }

          // Remove the trailing '&' if it exists
          url = url.replace(/&$/, "");

          // Now append to the finalReply
          finalReply += `\n\n【更多資訊】請參考: ${url}`;
        }

        // 3) Return the combined response to the frontend
        return res.json({ response: finalReply });
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
  conversationState[user_id] = { currentNode: "greeting", email:"" };

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
