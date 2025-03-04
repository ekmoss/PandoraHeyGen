# Pandora - Customized HeyGen Interactive Avatar

![Pandora Interactive Avatar](./public/demo.png)

This is a customized version of the HeyGen Interactive Avatar demo, tailored specifically for Capgemini's trade show experience. The avatar has been optimized for touch screens in portrait mode with a focus on user-friendly interaction.

## Features

- **Full-screen Portrait Mode**: Optimized for large touchscreen displays
- **Push-to-Talk Interface**: Simple tap-to-toggle microphone control
- **Auto-configuration**: Avatar settings are loaded from environment variables
- **Capgemini Branding**: Uses Capgemini AUNZ colors and design language
- **Admin Panel**: Hidden configuration panel accessible by typing "admin"

## Environment Configuration

Configuration is managed through environment variables in the `.env` file:

```
HEYGEN_API_KEY=your_api_key_here
NEXT_PUBLIC_DEFAULT_AVATAR_ID=avatar_id_here
NEXT_PUBLIC_DEFAULT_KNOWLEDGE_ID=knowledge_id_here
NEXT_PUBLIC_DEFAULT_LANGUAGE=en-US
NEXT_PUBLIC_AVATAR_NAME=Pandora
NEXT_PUBLIC_AVATAR_TAGLINE=The Capgemini AUNZ Assistant
```

## Getting Started

1. Clone this repo
2. Navigate to the repo folder in your terminal
3. Run `npm install`
4. Enter your HeyGen Enterprise API Token or Trial Token in the `.env` file
5. Configure the default avatar settings in the `.env` file
6. Run `npm run dev`

## Admin Access

To access the admin configuration panel at any time:

1. Type "admin" on your keyboard
2. Enter the access code: "capgemini123"
3. Adjust settings as needed
4. Click "Start With Custom Settings" to begin a session with these settings

## Trade Show Usage Guidelines

For the best trade show experience:

- Ensure the device is in portrait orientation
- Use a device with a responsive touchscreen
- Test microphone functionality before the event
- Ensure internet connectivity is stable
- Keep the avatar at "High" quality setting for best visual appearance

## Original HeyGen Documentation

### Which Avatars can I use with this project?

By default, there are several Public Avatars that can be used in Interactive Avatar. (AKA Interactive Avatars.) You can find the Avatar IDs for these Public Avatars by navigating to [app.heygen.com/interactive-avatar](https://app.heygen.com/interactive-avatar) and clicking 'Select Avatar' and copying the avatar id.

In order to use a private Avatar created under your own account in Interactive Avatar, it must be upgraded to be a Interactive Avatar. Only 1. Finetune Instant Avatars and 2. Studio Avatars are able to be upgraded to Interactive Avatars. This upgrade is a one-time fee and can be purchased by navigating to [app.heygen.com/interactive-avatar] and clicking 'Select Avatar'.

Please note that Photo Avatars are not compatible with Interactive Avatar and cannot be used.

### Where can I read more about enterprise-level usage of the Interactive Avatar API?

Please read our Interactive Avatar 101 article for more information on pricing and how to increase your concurrent session limit: https://help.heygen.com/en/articles/9182113-interactive-avatar-101-your-ultimate-guide
