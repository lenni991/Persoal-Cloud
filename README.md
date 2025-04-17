# Persoal-Cloud-Project
self-hosted software that allows users to create their personal cloud storage and collaboration platform. With its user-friendly interface. It is alternative to commercial cloud storage services. Store and access your files securely on your own hardware, maintaining complete control over your data.

## Features

- **File Storage & Management**: Upload, download, organize, and share files
- **User Authentication**: Secure access control to your personal data
- **Mobile Compatibility**: Access your files from any device
- **Encryption**: Optional end-to-end encryption for sensitive files
- **Simple Setup**: Easy installation on most hardware platforms

## Requirements

- Web server with PHP support
- MySQL/MariaDB database
- 1GB+ RAM recommended
- Modern web browser

## Quick Start

```bash
# Clone the repository
git clone https://github.com/lenni991/Persoal-Cloud.git

# Navigate to the project directory
cd Persoal-Cloud

# Configure your environment
cp config.example.php config.php
# Edit config.php with your database settings

# Set appropriate permissions
chmod 755 -R ./
chmod 777 -R ./data

# Access through your web server
# http://yourserver/personal-cloud/
```
