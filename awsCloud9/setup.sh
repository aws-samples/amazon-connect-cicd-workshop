#!/bin/bash

sudo yum -y update

# Remove AWS CLI v1
sudo rm -rf /usr/aws
sudo rm -rf /usr/bin/aws

#install AWS CLI v2
curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip
unzip -u awscliv2.zip
sudo ./aws/install

rm -f awscliv2.zip
rm -rf aws

# Reset terminal after installing applications
reset

echo Versions
echo AWS CDK: $(cdk --version)
echo AWS CLI: $(aws --version)
echo Node.js: $(node -v)
echo NPM: $(npm -v)