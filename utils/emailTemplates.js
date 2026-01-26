const getBaseEmailHtml = (content) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Fydblock Notification</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #050B0D;
      font-family: 'Arial', sans-serif;
      color: #ffffff;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #050B0D;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #ffffff;
      margin-bottom: 40px;
      display: block;
    }
    .logo span {
      color: #00FF9D;
    }
    h1 {
      font-size: 28px;
      text-align: center;
      margin-bottom: 30px;
      font-weight: normal;
      color: #ffffff;
    }
    p {
      color: #cccccc;
      line-height: 1.6;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .highlight {
      color: #00FF9D;
      font-weight: bold;
    }
    .btn {
      display: block;
      width: 100%;
      background-color: #00FF9D;
      color: #000000;
      text-align: center;
      padding: 15px 0;
      border-radius: 8px;
      text-decoration: none;
      font-weight: bold;
      font-size: 16px;
      margin-top: 30px;
      margin-bottom: 30px;
    }
    .btn-white {
      background-color: #ffffff;
      color: #000000;
      border: 1px solid #ffffff;
    }
    .info-box {
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 10px;
    }
    .info-row:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .label {
      color: #888888;
    }
    .value {
      color: #ffffff;
      font-weight: bold;
      text-align: right;
    }
    .footer {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 20px;
      text-align: center;
      font-size: 12px;
      color: #666666;
      margin-top: 40px;
    }
    .social-links {
      margin-bottom: 15px;
    }
    .social-links span {
      display: inline-block;
      width: 28px; 
      height: 28px; 
      background: #ffffff; 
      border-radius: 50%; 
      line-height: 28px; 
      color: #000; 
      margin: 0 5px;
      font-weight: bold;
      font-size: 12px;
    }
    .footer-links a {
      color: #666666;
      text-decoration: underline;
      margin: 0 5px;
    }
    /* Specific Styles */
    .red-text { color: #ef4444; }
    .green-text { color: #00FF9D; }
    
    .target-box {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 20px 40px;
        margin: 30px 0;
    }
    .target-item {
        text-align: center;
    }
    .target-label {
        color: #888;
        font-size: 12px;
        margin-bottom: 5px;
        display: block;
    }
    .target-val {
        font-size: 24px;
        font-weight: bold;
    }

  </style>
</head>
<body>
  <div style="padding: 20px;">
    <div class="container">
       <div class="logo" style="text-align: center; margin-bottom: 30px;">
           <img src="${process.env.FRONTEND_URL}/logo.png" alt="Fydblock" style="height: 60px; width: auto;" onerror="this.onerror=null; this.src='https://placehold.co/150x40/050B0D/00FF9D?text=Fydblock';">
       </div>
      ${content}
      
      <p style="text-align: center; font-size: 12px; color: #888; margin-top: 30px;">
        Need help? Watch our <a href="#" style="color: #00FF9D;">5-minute tutorial video</a> or reply to this email.
      </p>
      
      <div class="footer">
        <div class="social-links">
           <!-- Placeholder Icons -->
           <span>f</span> <span>t</span> <span>in</span> <span>ig</span>
        </div>
        
        <p>
          &copy; 2025 Fydblock Pvt Ltd.<br>
          Reg nr. 57541<br>
          License nr. 59990<br>
          Address: Building A1, Dubai Digital Park, Dubai Silicon Oasis, Dubai, United Arab Emirates
        </p>
        
        <div class="footer-links">
          <a href="#">Unsubscribe</a> | <a href="#">Privacy Policy</a> | <a href="#">Support</a>
        </div>
        <div style="margin-top: 15px; font-size: 10px; color: #444;">
            Ref: ${new Date().getTime().toString(36)}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
    `;
};

// 1. Welcome / Verification Email
const getWelcomeEmailHtml = (name, code) => {
  const content = `
      <h1>Welcome To Fydblock</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>Welcome to fydblock! Please verify your email address to activate your account.</p>
      
      <div style="text-align: center; margin: 30px 0;">
          <p style="font-size: 14px; color: #888; margin-bottom: 10px;">Verification Code</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #00FF9D; background: rgba(0, 255, 157, 0.1); padding: 15px; border-radius: 8px; display: inline-block;">
            ${code}
          </div>
      </div>

      <p>Enter this code on the verification screen to continue setting up your bot.</p>
      
      <p style="font-size: 12px; color: #666; margin-top: 20px;">If you didn't create an account, you can safely ignore this email.</p>
    `;
  return getBaseEmailHtml(content);
};

// 2. New Login Detected
const getNewLoginEmailHtml = (name, device, location, time, ip) => {
  const content = `
      <h1>New Login Detected</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>We noticed a new login to your Fydblock account.</p>
      
      <div class="info-box" style="border: 1px solid #00FF9D; background: rgba(0,255,157,0.02);">
        <p style="margin: 5px 0; font-size: 13px;"><span class="green-text" style="font-weight:bold;">• Device:</span> ${device}</p>
        <p style="margin: 5px 0; font-size: 13px;"><span class="green-text" style="font-weight:bold;">• Location:</span> ${location} (IP: ${ip})</p>
        <p style="margin: 5px 0; font-size: 13px;"><span class="green-text" style="font-weight:bold;">• Time:</span> ${time}</p>
      </div>

      <p>If this was you, you can safely ignore this email.<br>
      <span class="red-text">If you did not authorize this login, please secure your account immediately.</span></p>

      <a href="${process.env.FRONTEND_URL}/resetpass" class="btn btn-white" style="color:black; background:white;">Lock account & Reset Password</a>
    `;
  return getBaseEmailHtml(content);
};

// 3. API Connection Lost
const getApiConnectionLostEmailHtml = (name, exchangeName) => {
  const content = `
      <h1>API Connection Lost</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>We are unable to communicate with your ${exchangeName} exchange account.<br>
      This may be because your API key has expired, was revoked, or IP whitelist settings have changed. Your active bots on this exchange have been paused to prevent errors.</p>
      
      <a href="${process.env.FRONTEND_URL}/my-exchanges" class="btn">Reconnect API</a>
      
      <p>Go to your dashboard settings to generate a new key or troubleshoot the connection.</p>
    `;
  return getBaseEmailHtml(content);
};

// 4. Target Reached
const getTargetReachedEmailHtml = (name, botName, profitPercent, pair) => {
  const content = `
      <h1>Target Reached</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>Good news! Your bot ${botName} has reached its take-profit target.</p>
      
      <div class="target-box">
         <div class="target-item">
            <span class="target-label">Profit</span>
            <span class="target-val green-text">+${profitPercent}%</span>
         </div>
         <div class="target-item">
            <span class="target-label">Pair</span>
            <span class="target-val">${pair}</span>
         </div>
      </div>
      
      <p>The bot will continue running according to your strategy cycle settings. You can view detailed performance logs in your dashboard.</p>
      
      <a href="${process.env.FRONTEND_URL}/dashboard" class="btn" style="background: #11332a; color: white; border: 1px solid #00FF9D;">View Bot Dashboard</a>
    `;
  return getBaseEmailHtml(content);
};

// 5. Payment Confirmed
const getPaymentConfirmedEmailHtml = (name, planName, date, amount) => {
  const content = `
      <h1>Payment Confirmed</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>Thanks for using Fydblock. Here is your receipt for the recent payment.</p>
      
      <div class="info-box">
          <div class="info-row">
              <span class="label">Plan</span>
              <span class="value">${planName}</span>
          </div>
          <div class="info-row">
              <span class="label">Date</span>
              <span class="value">${date}</span>
          </div>
           <div class="info-row" style="border:none;">
              <span class="label">Total</span>
              <span class="value green-text">${amount}</span>
          </div>
      </div>
      
      <p>A PDF copy of this invoice is attached to this email.</p>
      
      <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.FRONTEND_URL}/subscription" style="color: #00FF9D; text-decoration: none; font-size: 14px;">Manage Subscription</a>
      </div>
    `;
  return getBaseEmailHtml(content);
};

// 6. Payment Failed
const getPaymentFailedEmailHtml = (name) => {
  const content = `
      <h1>Payment Failed</h1>
      <p>Hello ${name || 'Trader'},</p>
      <p>We attempted to renew your <strong>Pro Plan</strong> subscription but the payment failed.<br>
      This usually happens due to an expired card or insufficient funds. We will retry the payment in <strong>24 hours</strong>.</p>
      
      <p>To avoid service interruption (and your bots pausing), please update your payment method.</p>
      
      <a href="${process.env.FRONTEND_URL}/subscription" class="btn btn-white">Upload payment info</a>
    `;
  return getBaseEmailHtml(content);
};


// 7. Password Reset Request
const getPasswordResetEmailHtml = (resetUrl) => {
  const content = `
      <h1>Password Reset Request</h1>
      <p>You have requested to reset your password.</p>
      
      <p>Please click the button below to set a new password:</p>
      
      <a href="${resetUrl}" class="btn">Reset Password</a>
      
      <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
      <p style="word-break: break-all; font-size: 12px; color: #888;">${resetUrl}</p>
      
      <p>If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
    `;
  return getBaseEmailHtml(content);
};

module.exports = {
  getWelcomeEmailHtml,
  getNewLoginEmailHtml,
  getApiConnectionLostEmailHtml,
  getTargetReachedEmailHtml,
  getPaymentConfirmedEmailHtml,
  getPaymentFailedEmailHtml,
  getPasswordResetEmailHtml
};
