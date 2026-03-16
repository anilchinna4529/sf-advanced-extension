/**
 * AI Assistant Module
 * Natural language to SOQL conversion and Salesforce help using OpenAI API
 */

const AIAssistant = {
    conversationHistory: [],

    init() {
        document.getElementById('btn-ai-send').addEventListener('click', () => this.sendMessage());

        document.getElementById('ai-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    },

    async sendMessage() {
        const input = document.getElementById('ai-input');
        const message = input.value.trim();
        if (!message) return;

        // Add user message to chat
        this.addMessage(message, 'user');
        input.value = '';

        // Show typing indicator
        const typingId = this.addTypingIndicator();

        try {
            const settings = await getSettings();

            if (!settings.openaiApiKey) {
                this.removeTypingIndicator(typingId);
                this.addMessage('Please set your OpenAI API key in Settings (⚙️) to use the AI assistant.', 'bot');
                return;
            }

            // Get current org metadata for context
            let contextInfo = '';
            try {
                const activeOrg = await sendMessage({ action: 'getActiveOrg' });
                if (activeOrg && !activeOrg.error) {
                    contextInfo = `Connected to Salesforce org: ${activeOrg.userName} (${activeOrg.orgType}).\n`;

                    const globalDesc = await sendMessage({ action: 'describeGlobal' });
                    if (globalDesc?.sobjects) {
                        const objectNames = globalDesc.sobjects.slice(0, 50).map(o => o.name).join(', ');
                        contextInfo += `Available objects include: ${objectNames}\n`;
                    }
                }
            } catch { }

            // Build prompt
            const systemPrompt = `You are a Salesforce developer assistant integrated into a Chrome extension. 
You help users with:
1. Generating valid SOQL queries from natural language
2. Explaining Apex errors and suggesting fixes
3. Understanding Salesforce governor limits
4. Optimizing queries and code
5. Understanding object relationships

${contextInfo}

When generating SOQL queries:
- Always use proper Salesforce SOQL syntax
- Include relevant fields
- Add appropriate WHERE clauses
- Use relationship queries when needed
- Wrap SOQL in code blocks

Keep responses concise and focused. Use code blocks for SOQL and Apex.`;

            this.conversationHistory.push({ role: 'user', content: message });

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.openaiApiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...this.conversationHistory.slice(-10)
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `API Error: ${response.status}`);
            }

            const data = await response.json();
            const aiResponse = data.choices[0]?.message?.content || 'No response';

            this.conversationHistory.push({ role: 'assistant', content: aiResponse });

            this.removeTypingIndicator(typingId);
            this.addMessage(aiResponse, 'bot');
        } catch (error) {
            this.removeTypingIndicator(typingId);
            this.addMessage(`Error: ${error.message}`, 'bot');
        }
    },

    addMessage(content, sender) {
        const container = document.getElementById('ai-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-message ai-${sender}`;

        const avatar = sender === 'user' ? '👤' : '🤖';

        // Process markdown-like formatting
        let html = content;

        // Code blocks
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-primary);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        msgDiv.innerHTML = `
      <div class="ai-avatar">${avatar}</div>
      <div class="ai-bubble">${html}</div>
    `;

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    },

    addTypingIndicator() {
        const container = document.getElementById('ai-messages');
        const id = 'typing-' + Date.now();
        const div = document.createElement('div');
        div.className = 'ai-message ai-bot';
        div.id = id;
        div.innerHTML = `
      <div class="ai-avatar">🤖</div>
      <div class="ai-bubble" style="display:flex;gap:4px;align-items:center">
        <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
        <span style="color:var(--text-muted)">Thinking...</span>
      </div>
    `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return id;
    },

    removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }
};

document.addEventListener('DOMContentLoaded', () => AIAssistant.init());

if (typeof window !== 'undefined') {
    window.AIAssistant = AIAssistant;
}
