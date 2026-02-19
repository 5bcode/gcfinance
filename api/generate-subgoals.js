module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { goalName } = req.body;
    if (!goalName) {
        return res.status(400).json({ error: 'Goal name is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('API Key Missing in Vercel Environment Variables');
        return res.status(500).json({
            error: 'Configuration Error: GEMINI_API_KEY is missing. Please add it to your Vercel project settings.'
        });
    }

    try {
        const prompt = `
      Act as a financial planner. Break down the savings goal "${goalName}" into 3-6 specific, actionable sub-goals with realistic target amounts in GBP (£).
      Examples:
      - "Wedding" -> Venue Deposit (£2000), Catering (£4000), Dress/Suit (£1500), Photographer (£1200)
      - "Emergency Fund" -> 1 Month Expenses (£2000), 3 Month Buffer (£6000), Unexpected Repairs (£1000)
      - "New Car" -> Down Payment (£3000), Insurance (£500), Tax/Registration (£300)
      
      Return ONLY a raw JSON object with this structure:
      {
        "subGoals": [
          { "name": "Sub-goal Name", "target": 1000 }
        ]
      }
      Do not include markdown formatting or backticks.
    `;

        // Use built-in fetch (Node 18+)
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                }),
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            console.error('Gemini API Error:', errText);
            throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidate) {
            throw new Error('No valid response from AI');
        }

        // Clean up markdown if present (just in case)
        const jsonStr = candidate.replace(/```json/g, '').replace(/```/g, '').trim();
        const result = JSON.parse(jsonStr);

        return res.status(200).json(result);

    } catch (error) {
        console.error('AI Processing Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to generate goal breakdown.',
            details: error.toString()
        });
    }
};
