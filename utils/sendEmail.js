const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    // 1) Create a transporter
    // 1) Create a transporter
    const port = process.env.EMAIL_PORT || 465;
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
        port: port,
        secure: port == 465, // true for 465, false for other ports (587)
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    // 2) Define the email options
    const mailOptions = {
        from: `FydBlock <${process.env.EMAIL_USERNAME}>`,
        to: options.email,
        subject: options.subject,
        html: options.message
    };

    // 3) Actually send the email
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email Sent] MessageId: ${info.messageId}`);
    } catch (error) {
        console.error(`[Email Error] Failed to send email to ${options.email}. Error: ${error.message}`);
        // Throw error so controller knows it failed
        throw error;
    }
};

module.exports = sendEmail;
