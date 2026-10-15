// Sends TraceTray's own emails (deletion notices, later the weekly summary) through Amazon SES.
// Stripe sends receipts and trial reminders; Clerk sends sign-in emails.
// Without EMAIL_FROM (local development) emails are logged instead of sent.
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const logger = require("./logger");

const REPLY_TO = "support@tracetray.com";
let client;

async function sendEmail({ to, subject, text, html, unsubscribe = null }) {
    if (!process.env.EMAIL_FROM) {
        logger.info(`email not sent (no EMAIL_FROM)  to=${to}  subject=${subject}`);
        return { sent: false };
    }
    client ||= new SESv2Client({
        region: process.env.EMAIL_REGION || "us-east-1",
        ...(process.env.EMAIL_AWS_PROFILE ? { profile: process.env.EMAIL_AWS_PROFILE } : {})
    });
    const charset = "UTF-8";
    await client.send(new SendEmailCommand({
        FromEmailAddress: process.env.EMAIL_FROM,
        ReplyToAddresses: [REPLY_TO],
        Destination: { ToAddresses: [to] },
        Content: { Simple: {
            Subject: { Data: subject, Charset: charset },
            Body: { Text: { Data: text, Charset: charset }, Html: { Data: html, Charset: charset } },
            // Lets mail apps show their own one-click unsubscribe button.
            ...(unsubscribe ? { Headers: [
                { Name: "List-Unsubscribe", Value: `<${unsubscribe}>` },
                { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }
            ] } : {})
        } }
    }));
    logger.info(`email sent  to=${to}  subject=${subject}`);
    return { sent: true };
}

module.exports = { sendEmail };
