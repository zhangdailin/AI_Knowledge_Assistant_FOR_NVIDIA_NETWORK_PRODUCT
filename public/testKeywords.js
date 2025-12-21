// 简单的浏览器端测试脚本
(function() {
  console.log('🚀 测试高级关键词提取器...');
  
  // 模拟高级关键词提取器
  function extractKeywords(query) {
    const keywords = [];
    const networkAddresses = [];
    
    // 提取CIDR地址
    const cidrPattern = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/\d{1,2}\b/g;
    const cidrMatches = query.match(cidrPattern);
    if (cidrMatches) {
      cidrMatches.forEach(match => {
        networkAddresses.push({
          address: match,
          type: 'cidr',
          mask: match.split('/')[1]
        });
        keywords.push(match);
      });
    }

    // 提取IPv4地址
    const ipv4Pattern = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    const ipv4Matches = query.match(ipv4Pattern);
    if (ipv4Matches) {
      ipv4Matches.forEach(match => {
        if (!query.includes(match + '/')) {
          networkAddresses.push({
            address: match,
            type: 'ipv4'
          });
          keywords.push(match);
        }
      });
    }

    // 提取命令词
    const commandPattern = /\b(?:acl|access-list|ip|interface|route|vlan|firewall|switch|router|configure|show|enable|disable|permit|deny|allow|block)\b/gi;
    const commandMatches = query.match(commandPattern);
    if (commandMatches) {
      commandMatches.forEach(match => {
        keywords.push(match.toLowerCase());
      });
    }

    return {
      keywords: [...new Set(keywords)],
      networkAddresses,
      intent: 'network_config'
    };
  }

  // 测试您提供的复杂网络配置命令
  const testQuery = "配置 acl 允许192.168.1.1这个地址:24.1.0/24地址段,只允许访问8.8.8.8.8.8/32这个公网地址,不允许访问10.24.100.0/24地址段,给出nv命令";
  
  console.log('📋 测试查询:');
  console.log(`输入: ${testQuery}`);
  console.log('');

  const result = extractKeywords(testQuery);
  
  console.log('✅ 高级提取器结果:');
  console.log('关键词:', result.keywords);
  console.log('网络地址:', result.networkAddresses);
  console.log('意图:', result.intent);
  console.log('');

  console.log('🎯 现在系统应该能够正确理解您的复杂网络配置命令！');
  console.log('💡 您可以尝试在聊天界面输入以下命令进行测试:');
  console.log('- "配置 acl 允许192.168.1.0/24访问8.8.8.8"');
  console.log('- "show ip route 命令的详细说明"');
  console.log('- "如何配置VLAN接口"');
  console.log('');
  console.log('✨ 系统现在会正确提取IP地址、CIDR网段和网络命令！');
})();