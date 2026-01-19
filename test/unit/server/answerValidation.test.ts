
import { describe, it, expect } from 'vitest';
import { validateAnswerConsistency } from '../../../server/answerValidation.mjs';

describe('Answer Validation Module', () => {
    it('should strip simple shell prompts', () => {
        const answer = `
    Run the following command:
    \`\`\`bash
    $ nv set interface swp1
    # nv config apply
    \`\`\`
    `;
        const references = [{ content: 'nv set interface swp1\nnv config apply' }];
        const result = validateAnswerConsistency(answer, references);

        expect(result.isConsistent).toBe(true);
        expect(result.hallucinations).toHaveLength(0);
        expect(result.verifiedCommands).toHaveLength(2);
        expect(result.verifiedCommands[0].command).toBe('nv set interface swp1');
    });

    it('should strip complex user@host prompts', () => {
        const answer = `
    Example:
    \`\`\`
    cumulus@leaf01$ nv set mlag enable on
    root@server:~# apt update
    \`\`\`
    `;
        const references = [{ content: 'nv set mlag enable on\napt update' }];
        const result = validateAnswerConsistency(answer, references);

        expect(result.isConsistent).toBe(true);
        expect(result.hallucinations).toHaveLength(0);
        expect(result.verifiedCommands[0].command).toBe('nv set mlag enable on');
        expect(result.verifiedCommands[1].command).toBe('apt update');
    });

    it('should handle inline code with prompts', () => {
        const answer = 'You can run `cumulus@leaf01$ nv show mlag` to check status.';
        const references = [{ content: 'nv show mlag' }];
        const result = validateAnswerConsistency(answer, references);

        expect(result.isConsistent).toBe(true);
        expect(result.hallucinations).toHaveLength(0);
        expect(result.verifiedCommands[0].command).toBe('nv show mlag');
    });

    it('should detect actual hallucinations', () => {
        const answer = 'Run `sudo rm -rf /` please.';
        const references = [{ content: 'nv set real-command' }];
        const result = validateAnswerConsistency(answer, references);

        expect(result.isConsistent).toBe(false);
        expect(result.hallucinations).toHaveLength(1);
        expect(result.hallucinations[0].command).toBe('sudo rm -rf /');
    });

    it('should handle multiple commands with mixed prompts', () => {
        const answer = `
     \`\`\`
     cumulus@leaf01$ nv set interface swp1 up
     $ nv config apply
     nv show interface
     \`\`\`
     `;
        const references = [{ content: 'nv set interface swp1 up\nnv config apply\nnv show interface' }];
        const result = validateAnswerConsistency(answer, references);

        expect(result.isConsistent).toBe(true);
        expect(result.verifiedCommands.map(c => c.command)).toEqual([
            'nv set interface swp1 up',
            'nv config apply',
            'nv show interface'
        ]);
    });
});
