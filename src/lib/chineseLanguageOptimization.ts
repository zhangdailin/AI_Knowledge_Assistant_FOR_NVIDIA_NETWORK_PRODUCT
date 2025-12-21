/**
 * 增强的中文语言优化模块
 * 完整处理英文到中文的转换
 */

export function optimizeChineseResponse(originalAnswer: string, references?: string[]): string {
  let optimized = originalAnswer;
  
  // 1. 完整的英文短语替换
  const completeTranslations = [
    {
      pattern: /Based on the reference content, here are the configuration commands:/gi,
      replacement: '基于参考内容，以下是配置命令：'
    },
    {
      pattern: /Based on the reference content/gi,
      replacement: '基于参考内容'
    },
    {
      pattern: /According to Reference (\d+),/gi,
      replacement: '根据参考文档$1，'
    },
    {
      pattern: /Please execute the following commands/gi,
      replacement: '请执行以下命令'
    },
    {
      pattern: /the following commands/gi,
      replacement: '以下命令'
    },
    {
      pattern: /the specific configuration is as follows/gi,
      replacement: '具体配置如下'
    },
    {
      pattern: /If the references don't contain complete information/gi,
      replacement: '如果参考文档不包含完整信息'
    },
    {
      pattern: /Never invent or hallucinate/gi,
      replacement: '绝不编造或幻觉'
    },
    {
      pattern: /Quote specific commands/gi,
      replacement: '引用具体命令'
    },
    {
      pattern: /from Reference (\d+)/gi,
      replacement: '来自参考文档$1'
    },
    {
      pattern: /from the documentation/gi,
      replacement: '来自文档'
    },
    {
      pattern: /in order to enable/gi,
      replacement: '为了启用'
    },
    {
      pattern: /to enable (\w+)/gi,
      replacement: '为了启用$1'
    },
    {
      pattern: /Here are the (\w+) configuration commands/gi,
      replacement: '以下是$1配置命令'
    },
    {
      pattern: /Here is the (\w+) configuration/gi,
      replacement: '以下是$1配置'
    }
  ];
  
  completeTranslations.forEach(translation => {
    optimized = optimized.replace(translation.pattern, translation.replacement);
  });
  
  // 2. 技术术语的中文解释
  const techTermExplanations = [
    {
      pattern: /PFC configuration/gi,
      replacement: 'PFC（Priority Flow Control，优先级流控制）配置'
    },
    {
      pattern: /ECN configuration/gi,
      replacement: 'ECN（Explicit Congestion Notification，显式拥塞通知）配置'
    },
    {
      pattern: /QoS configuration/gi,
      replacement: 'QoS（Quality of Service，服务质量）配置'
    },
    {
      pattern: /RoCE configuration/gi,
      replacement: 'RoCE（RDMA over Converged Ethernet）配置'
    },
    {
      pattern: /traffic-class/gi,
      replacement: '流量类别（traffic-class）'
    },
    {
      pattern: /min-threshold/gi,
      replacement: '最小阈值（min-threshold）'
    },
    {
      pattern: /max-threshold/gi,
      replacement: '最大阈值（max-threshold）'
    },
    {
      pattern: /congestion-control/gi,
      replacement: '拥塞控制（congestion-control）'
    }
  ];
  
  techTermExplanations.forEach(explanation => {
    optimized = optimized.replace(explanation.pattern, explanation.replacement);
  });
  
  // 3. 中文语言自然化
  const chineseNaturalizations = [
    {
      pattern: /Please execute these commands in order/gi,
      replacement: '请按顺序执行这些命令'
    },
    {
      pattern: /Please execute these commands/gi,
      replacement: '请执行这些命令'
    },
    {
      pattern: /according to your actual environment/gi,
      replacement: '根据您的实际环境'
    },
    {
      pattern: /adjust these parameters/gi,
      replacement: '调整这些参数'
    },
    {
      pattern: /based on your requirements/gi,
      replacement: '根据您的需求'
    },
    {
      pattern: /directly from the reference/gi,
      replacement: '直接来自参考文档'
    },
    {
      pattern: /reference documentation/gi,
      replacement: '参考文档'
    }
  ];
  
  chineseNaturalizations.forEach(naturalization => {
    optimized = optimized.replace(naturalization.pattern, naturalization.replacement);
  });
  
  // 4. 添加中文礼貌用语
  if (optimized.includes('请执行') && !optimized.includes('建议')) {
    optimized = optimized.replace(/请执行/g, '建议您执行');
  }
  
  // 5. 添加参考来源标注
  if (references && references.length > 0 && !optimized.includes('信息来源')) {
    if (optimized.includes('参考文档')) {
      optimized += '\n\n**信息来源**：以上配置信息来自提供的参考文档，请根据实际环境进行调整。';
    }
  }
  
  // 6. 确保整体语言风格一致
  if (!optimized.startsWith('根据') && !optimized.startsWith('基于') && !optimized.startsWith('以下是')) {
    if (references && references.length > 0) {
      optimized = '根据参考内容，' + optimized;
    }
  }
  
  // 7. 优化代码块前后的中文说明
  optimized = optimized.replace(/(以下命令[：：])\n?```bash/g, '$1\n```bash');
  optimized = optimized.replace(/```\n?(注意[：：])/g, '```\n$1');
  
  return optimized;
}

/**
 * 生成中文配置说明
 */
export function generateChineseConfigExplanation(command: string, configType: string): string {
  const explanations = {
    'pfc': '此命令配置PFC（Priority Flow Control，优先级流控制），用于实现基于优先级的流量控制机制，确保关键业务的无损传输',
    'ecn': '此命令配置ECN（Explicit Congestion Notification，显式拥塞通知），用于在网络拥塞时主动通知发送方降低发送速率',
    'qos': '此命令配置QoS（Quality of Service，服务质量）参数，优化网络流量管理和带宽分配',
    'interface': '此命令在指定的网络接口上应用相关配置设置',
    'nv config apply': '此命令使之前的配置更改生效，是应用配置的必要步骤',
    'switch-priority': '指定需要启用PFC的交换机优先级（通常为3,5等关键业务优先级）',
    'traffic-class': '定义流量类别，用于区分不同类型的网络流量',
    'min-threshold': '设置最小阈值，当队列长度超过此值时开始执行相关操作',
    'max-threshold': '设置最大阈值，当队列长度达到此值时执行最大强度的操作'
  };
  
  for (const [key, explanation] of Object.entries(explanations)) {
    if (command.toLowerCase().includes(key)) {
      return explanation;
    }
  }
  
  return `此命令用于${configType}配置，请根据实际需求和网络环境调整相关参数。`;
}