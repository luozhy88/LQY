// worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ==========================================
    // 发送邮件报告 API (EmailJS)
    // ==========================================
    if (url.pathname === "/api/send-email" && request.method === "POST") {
      try {
        const data = await request.json();
        const { profile, score, total, logs } = data;

        // EmailJS 配置
        const serviceID = 'service_j2ak28v';
        const templateID = 'template_ol3ws9o';
        const publicKey = 'bGbqCw1wlTrkCwfFo';
        const privateKey = 'DZc0GWCYIN_tMdOsQ27AM';

        // 获取当前中国时区时间
        const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

        // 分类统计
        const correctLogs = logs.filter(l => l.isCorrect);
        const incorrectLogs = logs.filter(l => !l.isCorrect);

        // 组装邮件内容
        let reportMessage = `亲爱的家长/老师：\n`;
        reportMessage += `学习者 ${profile} 刚刚完成了数学大冒险闯关！\n`;
        reportMessage += `⏰ 时间：${currentTime}\n`;
        reportMessage += `🏆 最终得分： ${score} / ${total} 分\n\n`;

        reportMessage += `📚 今天挑战的所有题目：\n`;
        logs.forEach((log, index) => {
          const status = log.isCorrect ? '✅' : '❌';
          reportMessage += `${index + 1}. [${log.year}] ${log.title}\n   ${status} 题目：${log.question}\n   (答案：${log.keyPoint})\n`;
        });

        reportMessage += `\n✅ 答对的题目（已掌握）：\n`;
        if (correctLogs.length > 0) {
          correctLogs.forEach(log => {
            reportMessage += ` - [${log.year}] ${log.title} (考点: ${log.tag})\n`;
          });
        } else {
          reportMessage += ` - 无\n`;
        }

        reportMessage += `\n⚠️ 答错的题目（需要复习）：\n`;
        if (incorrectLogs.length > 0) {
          incorrectLogs.forEach(log => {
            reportMessage += ` - [${log.year}] ${log.title}\n   题目：${log.question}\n   正确答案：${log.keyPoint}\n   易错点：${log.commonError}\n`;
          });
        } else {
          reportMessage += ` - 无\n`;
        }

        // 定义收件邮箱列表
        const recipients = ['oliviaxiao2015@126.com', '479321347@qq.com'];
        
        // 并行发送邮件给所有收件人
        const sendPromises = recipients.map(async (recipientEmail) => {
          const emailRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              service_id: serviceID,
              template_id: templateID,
              user_id: publicKey,
              accessToken: privateKey,
              template_params: {
                title: `数学大冒险报告：${profile} 完成闯关`,
                name: profile,
                time: currentTime,
                message: reportMessage,
                to_email: recipientEmail
              }
            })
          });
          
          const responseText = await emailRes.text();
          return { email: recipientEmail, ok: emailRes.ok, response: responseText };
        });
        
        const results = await Promise.all(sendPromises);
        
        // 检查是否有发送失败的
        const failedSends = results.filter(r => !r.ok);
        
        if (failedSends.length > 0) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: `部分邮件发送失败: ${failedSends.map(f => f.email).join(', ')}`,
            details: failedSends
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: `邮件已成功发送给 ${results.length} 个收件人`,
          recipients: results.map(r => r.email)
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { 
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/memory/get" && request.method === "GET") {
      const userProfile = url.searchParams.get("userProfile");
      if (!userProfile) return new Response("Missing userProfile", { status: 400 });
      try {
        const { results } = await env.DB.prepare(
          "SELECT * FROM ebbinghaus_records WHERE user_profile = ? ORDER BY next_review_time ASC"
        ).bind(userProfile).all();
        const formattedResults = results.map((row) => ({
          id: row.id,
          questionId: row.question_id,
          level: row.level,
          nextReviewTime: row.next_review_time
        }));
        return new Response(JSON.stringify(formattedResults), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    if (url.pathname === "/api/memory/upsert" && request.method === "POST") {
      try {
        const data = await request.json();
        const { userProfile, questionId, level, nextReviewTime } = data;
        const id = userProfile + "_" + questionId;
        const now = Date.now();
        await env.DB.prepare(`
          INSERT INTO ebbinghaus_records (id, user_profile, question_id, level, next_review_time, last_updated)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          ON CONFLICT(id) DO UPDATE SET 
          level = excluded.level, 
          next_review_time = excluded.next_review_time, 
          last_updated = excluded.last_updated
        `).bind(id, userProfile, questionId, level, nextReviewTime, now).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    if (url.pathname === "/api/memory/clear" && request.method === "POST") {
      try {
        const data = await request.json();
        const { userProfile } = data;
        await env.DB.prepare("DELETE FROM ebbinghaus_records WHERE user_profile = ?").bind(userProfile).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    return new Response(HTML_CONTENT, {
      headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
  }
};

// 森林数学大冒险题库 - 共52道题目（来自pdf1.txt）
var mathQuestions = [
  {
    id: 101,
    year: "第1单元",
    tag: "基础计算",
    title: "15减7",
    question: "15 - 7 = ?",
    keyPoint: "8",
    options: ["7", "8", "9"],
    commonError: "退位减法不熟练",
    explanation: "15-7，把15分成10和5，10-7=3，3+5=8"
  },
  {
    id: 102,
    year: "第1单元",
    tag: "基础计算",
    title: "14减7",
    question: "14 - 7 = ?",
    keyPoint: "7",
    options: ["6", "7", "8"],
    commonError: "减法计算错误",
    explanation: "14-7=7，可以直接记住或者分步计算"
  },
  {
    id: 103,
    year: "第1单元",
    tag: "基础计算",
    title: "18减2",
    question: "18 - 2 = ?",
    keyPoint: "16",
    options: ["15", "16", "17"],
    commonError: "个位减法出错",
    explanation: "18-2，个位8-2=6，结果是16"
  },
  {
    id: 104,
    year: "第1单元",
    tag: "基础计算",
    title: "14减5",
    question: "14 - 5 = ?",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "退位减法错误",
    explanation: "14-5，把14分成10和4，10-5=5，5+4=9"
  },
  {
    id: 105,
    year: "第1单元",
    tag: "基础计算",
    title: "20减3",
    question: "20 - 3 = ?",
    keyPoint: "17",
    options: ["16", "17", "18"],
    commonError: "借位计算错误",
    explanation: "20-3，把20分成10和10，10-3=7，10+7=17"
  },
  {
    id: 106,
    year: "第1单元",
    tag: "基础计算",
    title: "11减5",
    question: "11 - 5 = ?",
    keyPoint: "6",
    options: ["5", "6", "7"],
    commonError: "退位减法不熟练",
    explanation: "11-5，把11分成10和1，10-5=5，5+1=6"
  },
  {
    id: 107,
    year: "第1单元",
    tag: "基础计算",
    title: "20减4",
    question: "20 - 4 = ?",
    keyPoint: "16",
    options: ["15", "16", "17"],
    commonError: "计算出错",
    explanation: "20-4=16"
  },
  {
    id: 108,
    year: "第1单元",
    tag: "基础计算",
    title: "18减9",
    question: "18 - 9 = ?",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "忘记退位",
    explanation: "18-9=9，可以记住这个常见组合"
  },
  {
    id: 109,
    year: "第1单元",
    tag: "基础计算",
    title: "16减7",
    question: "16 - 7 = ?",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "减法出错",
    explanation: "16-7=9"
  },
  {
    id: 110,
    year: "第1单元",
    tag: "基础计算",
    title: "14减6",
    question: "14 - 6 = ?",
    keyPoint: "8",
    options: ["7", "8", "9"],
    commonError: "退位计算错误",
    explanation: "14-6=8"
  },
  {
    id: 111,
    year: "第1单元",
    tag: "基础计算",
    title: "12减7",
    question: "12 - 7 = ?",
    keyPoint: "5",
    options: ["4", "5", "6"],
    commonError: "计算不熟练",
    explanation: "12-7=5"
  },
  {
    id: 112,
    year: "第1单元",
    tag: "基础计算",
    title: "13减5",
    question: "13 - 5 = ?",
    keyPoint: "8",
    options: ["7", "8", "9"],
    commonError: "减法出错",
    explanation: "13-5=8"
  },
  {
    id: 113,
    year: "第1单元",
    tag: "基础计算",
    title: "连减运算",
    question: "12 - 3 - 6 = ?",
    keyPoint: "3",
    options: ["2", "3", "4"],
    commonError: "从左到右依次计算出错",
    explanation: "先算12-3=9，再算9-6=3"
  },
  {
    id: 114,
    year: "第1单元",
    tag: "基础计算",
    title: "加减混合",
    question: "6 + 8 - 9 = ?",
    keyPoint: "5",
    options: ["4", "5", "6"],
    commonError: "运算顺序出错",
    explanation: "先算6+8=14，再算14-9=5"
  },
  {
    id: 115,
    year: "第1单元",
    tag: "基础计算",
    title: "加减混合",
    question: "20 - 9 + 5 = ?",
    keyPoint: "16",
    options: ["15", "16", "17"],
    commonError: "计算错误",
    explanation: "先算20-9=11，再算11+5=16"
  },
  {
    id: 116,
    year: "第1单元",
    tag: "应用题",
    title: "5G信号塔安装",
    question: "总共要安装15个5G信号塔，已经安装了6个。还剩多少个没有安装？",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "用加法计算",
    explanation: "求剩余用减法：15-6=9个"
  },
  {
    id: 117,
    year: "第1单元",
    tag: "应用题",
    title: "牛奶剩余问题",
    question: "一箱牛奶共有12瓶，小华每天喝1瓶，喝了一个星期。还剩多少瓶？",
    keyPoint: "5",
    options: ["4", "5", "6"],
    commonError: "不知道一星期是7天",
    explanation: "一星期=7天，12-7=5瓶"
  },
  {
    id: 118,
    year: "第1单元",
    tag: "应用题",
    title: "看书页数比较",
    question: "欢欢和乐乐看同一本书。欢欢看了15页，乐乐看了8页。谁剩下的页数多？多几页？",
    keyPoint: "乐乐，7页",
    options: ["欢欢，7页", "乐乐，7页", "一样多"],
    commonError: "认为看得多剩得多",
    explanation: "看得少剩得多，15-8=7页"
  },
  {
    id: 119,
    year: "第1单元",
    tag: "应用题",
    title: "鸭子数量",
    question: "鸭妈妈带着11只小鸭来到河边，先让6只下水，岸边还有几只鸭？",
    keyPoint: "6",
    options: ["5", "6", "7"],
    commonError: "忘记加鸭妈妈",
    explanation: "岸边=鸭妈妈+剩余小鸭=1+(11-6)=6只"
  },
  {
    id: 120,
    year: "第1单元",
    tag: "应用题",
    title: "停车场问题",
    question: "某停车场一共有17个停车位，剩余车位8个。已经停放了多少辆车？",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "用加法计算",
    explanation: "已停车辆=总车位-剩余车位=17-8=9辆"
  },
  {
    id: 121,
    year: "第1单元",
    tag: "应用题",
    title: "汤包问题",
    question: "一笼汤包有16个，一位客人吃了7个，另一位吃了4个，一共吃了多少个？",
    keyPoint: "11",
    options: ["10", "11", "12"],
    commonError: "用减法计算",
    explanation: "求一共吃了多少用加法：7+4=11个"
  },
  {
    id: 122,
    year: "第1单元",
    tag: "应用题",
    title: "梨膏糖问题",
    question: "乐乐有一些梨膏糖，吃了一半后还剩7块。原来有多少块？",
    keyPoint: "14",
    options: ["12", "14", "16"],
    commonError: "直接用7+1",
    explanation: "剩的是一半，原来有7×2=14块"
  },
  {
    id: 123,
    year: "第1单元",
    tag: "应用题",
    title: "排队问题",
    question: "14人排队，乐乐是003号，欢欢是012号，他们之间有多少人？",
    keyPoint: "8",
    options: ["7", "8", "9"],
    commonError: "直接用12-3",
    explanation: "12-3-1=8人（要减去欢欢本人）"
  },
  {
    id: 124,
    year: "第2单元",
    tag: "整十数计算",
    title: "整十数加法",
    question: "40 + 40 = ?",
    keyPoint: "80",
    options: ["70", "80", "90"],
    commonError: "忘记末尾加0",
    explanation: "4个十加4个十等于8个十，即80"
  },
  {
    id: 125,
    year: "第2单元",
    tag: "整十数计算",
    title: "整十数减法",
    question: "100 - 60 = ?",
    keyPoint: "40",
    options: ["30", "40", "50"],
    commonError: "计算错误",
    explanation: "10个十减6个十等于4个十，即40"
  },
  {
    id: 126,
    year: "第2单元",
    tag: "整十数计算",
    title: "整十数减法",
    question: "70 - 30 = ?",
    keyPoint: "40",
    options: ["30", "40", "50"],
    commonError: "忘记末尾有0",
    explanation: "7个十减3个十等于4个十，即40"
  },
  {
    id: 127,
    year: "第2单元",
    tag: "整十数计算",
    title: "整十数加法",
    question: "20 + 50 = ?",
    keyPoint: "70",
    options: ["60", "70", "80"],
    commonError: "计算错误",
    explanation: "2个十加5个十等于7个十，即70"
  },
  {
    id: 128,
    year: "第2单元",
    tag: "整十数计算",
    title: "整十数加减",
    question: "90 - 10 = ?",
    keyPoint: "80",
    options: ["70", "80", "90"],
    commonError: "计算出错",
    explanation: "90-10=80"
  },
  {
    id: 129,
    year: "第2单元",
    tag: "两位数计算",
    title: "两位数减一位数",
    question: "43 - 3 = ?",
    keyPoint: "40",
    options: ["39", "40", "41"],
    commonError: "十位也减了",
    explanation: "43-3，个位3-3=0，结果是40"
  },
  {
    id: 130,
    year: "第2单元",
    tag: "两位数计算",
    title: "两位数加一位数",
    question: "75 + 5 = ?",
    keyPoint: "80",
    options: ["70", "80", "85"],
    commonError: "忘记进位",
    explanation: "75+5=80，个位相加满十进一"
  },
  {
    id: 131,
    year: "第2单元",
    tag: "填未知数",
    title: "求减数",
    question: "30 + ( ) = 60，括号里填几？",
    keyPoint: "30",
    options: ["20", "30", "40"],
    commonError: "用加法计算",
    explanation: "60-30=30，所以括号里填30"
  },
  {
    id: 132,
    year: "第2单元",
    tag: "填未知数",
    title: "求被减数",
    question: "( ) - 10 = 40，括号里填几？",
    keyPoint: "50",
    options: ["40", "50", "60"],
    commonError: "用减法计算",
    explanation: "40+10=50，所以括号里填50"
  },
  {
    id: 133,
    year: "第2单元",
    tag: "应用题",
    title: "快递送货",
    question: "快递员上午送40个，下午送50个。今天一共要送多少个？",
    keyPoint: "90",
    options: ["80", "90", "100"],
    commonError: "用减法计算",
    explanation: "求一共用加法：40+50=90个"
  },
  {
    id: 134,
    year: "第2单元",
    tag: "应用题",
    title: "汉堡购买",
    question: "一个汉堡10元，爸爸有59元，最多能买几个？",
    keyPoint: "5",
    options: ["4", "5", "6"],
    commonError: "直接算59÷10=5.9",
    explanation: "59里有5个10，最多买5个，剩9元"
  },
  {
    id: 135,
    year: "第2单元",
    tag: "应用题",
    title: "桃子数量",
    question: "小猴吃一堆桃，上午吃一半，下午吃剩下的一半，最后剩10个。原来有多少个？",
    keyPoint: "40",
    options: ["30", "40", "50"],
    commonError: "直接用10×2",
    explanation: "倒推：剩10个，下午前有20个，原来有40个"
  },
  {
    id: 136,
    year: "第2单元",
    tag: "应用题",
    title: "班级人数",
    question: "大班、中班、小班共100人，大班和小班共70人，小班和中班共50人。小班有多少人？",
    keyPoint: "20",
    options: ["10", "20", "30"],
    commonError: "直接相加减",
    explanation: "中班=100-70=30人，小班=50-30=20人"
  },
  {
    id: 137,
    year: "第2单元",
    tag: "应用题",
    title: "拔河比赛",
    question: "一队15人，二队9人，要使比赛公平，一队要分给二队多少人？",
    keyPoint: "3",
    options: ["2", "3", "4"],
    commonError: "直接15-9",
    explanation: "相差6人，分一半6÷2=3人"
  },
  {
    id: 138,
    year: "第3单元",
    tag: "时间计算",
    title: "时间经过",
    question: "从晚上8时看到晚上10时，一共看了几小时？",
    keyPoint: "2",
    options: ["1", "2", "3"],
    commonError: "直接相减算错",
    explanation: "10-8=2小时"
  },
  {
    id: 139,
    year: "第3单元",
    tag: "时间推算",
    title: "时间推算",
    question: "现在是6时，3小时前是几时？",
    keyPoint: "3",
    options: ["2", "3", "4"],
    commonError: "用加法计算",
    explanation: "6-3=3时"
  },
  {
    id: 140,
    year: "第3单元",
    tag: "时间推算",
    title: "时间推算",
    question: "现在是6时，3小时后是几时？",
    keyPoint: "9",
    options: ["8", "9", "10"],
    commonError: "计算错误",
    explanation: "6+3=9时"
  },
  {
    id: 141,
    year: "第3单元",
    tag: "镜子时间",
    title: "镜子中的时间",
    question: "镜子中的钟面时间是8时，实际时间是几时？",
    keyPoint: "4",
    options: ["3", "4", "5"],
    commonError: "直接用12减",
    explanation: "镜子时间+实际时间=12，12-8=4时"
  },
  {
    id: 142,
    year: "第3单元",
    tag: "时钟敲响",
    title: "挂钟报时",
    question: "挂钟整时敲几下，半时敲1下。从0时到2时半，共敲了几下？",
    keyPoint: "5",
    options: ["4", "5", "6"],
    commonError: "漏算半时",
    explanation: "1时+2时+半时=1+2+1+1=5下（0时不敲）"
  },
  {
    id: 143,
    year: "第4单元",
    tag: "两位数加法",
    title: "不进位加法",
    question: "56 + 32 = ?",
    keyPoint: "88",
    options: ["78", "88", "98"],
    commonError: "数位对不齐",
    explanation: "个位6+2=8，十位5+3=8，结果是88"
  },
  {
    id: 144,
    year: "第4单元",
    tag: "两位数加法",
    title: "不进位加法",
    question: "42 + 24 = ?",
    keyPoint: "66",
    options: ["56", "66", "76"],
    commonError: "计算错误",
    explanation: "42+24=66"
  },
  {
    id: 145,
    year: "第4单元",
    tag: "两位数加法",
    title: "不进位加法",
    question: "35 + 14 = ?",
    keyPoint: "49",
    options: ["39", "49", "59"],
    commonError: "个位相加出错",
    explanation: "35+14=49"
  },
  {
    id: 146,
    year: "第4单元",
    tag: "两位数加法",
    title: "整十数加法",
    question: "40 + 25 = ?",
    keyPoint: "65",
    options: ["55", "65", "75"],
    commonError: "数位对不齐",
    explanation: "40+25=65"
  },
  {
    id: 147,
    year: "第4单元",
    tag: "混合运算",
    title: "连减运算",
    question: "15 - 7 - 6 = ?",
    keyPoint: "2",
    options: ["1", "2", "3"],
    commonError: "从左到右计算出错",
    explanation: "15-7=8，8-6=2"
  },
  {
    id: 148,
    year: "第4单元",
    tag: "混合运算",
    title: "加减混合",
    question: "16 - 8 + 4 = ?",
    keyPoint: "12",
    options: ["10", "12", "14"],
    commonError: "运算顺序出错",
    explanation: "16-8=8，8+4=12"
  },
  {
    id: 149,
    year: "第4单元",
    tag: "应用题",
    title: "跳绳数量",
    question: "王老师领来一些跳绳，给体育室5根，剩下的够44人每人一根。一共领来多少根？",
    keyPoint: "49",
    options: ["44", "49", "54"],
    commonError: "用减法计算",
    explanation: "总数=给出的+剩下的=5+44=49根"
  },
  {
    id: 150,
    year: "第4单元",
    tag: "应用题",
    title: "看书页码",
    question: "欢欢第一周看40页，第二周看52页，第三周从第几页开始看？",
    keyPoint: "93",
    options: ["92", "93", "94"],
    commonError: "忘记加1",
    explanation: "40+52=92页已看完，第三周从93页开始"
  },
  {
    id: 151,
    year: "第4单元",
    tag: "应用题",
    title: "页码之和",
    question: "书签夹在两页之间，页码之和是81，这两页分别是第几页和第几页？",
    keyPoint: "40和41",
    options: ["39和42", "40和41", "38和43"],
    commonError: "直接除以2",
    explanation: "相邻两页相差1，(81-1)÷2=40，所以是40和41页"
  },
  {
    id: 152,
    year: "第4单元",
    tag: "应用题",
    title: "楼房层数",
    question: "甜甜家住高层，从上往下数上面有13层，从下往上数下面有11层。这幢楼一共多少层？",
    keyPoint: "25",
    options: ["23", "24", "25"],
    commonError: "直接相加",
    explanation: "13+11+1=25层（要加上甜甜家所在层）"
  }
];
var HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>森林数学大冒险 - 艾宾浩斯记忆特训</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap');
        
        body { 
            font-family: 'ZCOOL KuaiLe', 'Segoe UI', Roboto, sans-serif; 
            background-image: radial-gradient(#bbf7d0 2px, transparent 2px);
            background-size: 30px 30px;
            background-color: #f0fdf4;
        }
        .tab-active { border-bottom: 3px solid #16a34a; color: #16a34a; font-weight: bold; }
        .tab-inactive { color: #6b7280; font-weight: 500; }
        .tab-inactive:hover { color: #374151; }
        .fade-in { animation: fadeIn 0.3s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        /* Quiz specific styles */
        .option-card { transition: all 0.2s; border: 2px solid transparent; background-color: #ffffff; box-shadow: 0 4px 0 #d1d5db; }
        .option-card:hover { transform: translateY(-2px); box-shadow: 0 6px 0 #bfdbfe; border-color: #bfdbfe; background-color: #eff6ff; }
        .option-card:active { transform: translateY(2px); box-shadow: 0 0 0 transparent; }
        .option-selected-correct { border-color: #10b981; background-color: #ecfdf5; box-shadow: 0 4px 0 #059669; }
        .option-selected-wrong { border-color: #ef4444; background-color: #fef2f2; box-shadow: 0 4px 0 #dc2626; }
        
        .spinner { border: 3px solid #f3f3f3; border-radius: 50%; border-top: 3px solid #3498db; width: 20px; height: 20px; animation: spin 2s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px;}
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        /* Table styles */
        .db-table th { background-color: #f8fafc; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; color: #64748b; }
        .db-table td { font-size: 0.875rem; color: #334155; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">

    <!-- Header -->
    <!-- 背景音乐 -->
    <audio id="bg-music" loop>
        <source src="https://cdn.pixabay.com/download/audio/2022/03/15/audio_6351ae71b2.mp3?filename=happy-day-113985.mp3" type="audio/mpeg">
    </audio>
    
    <header class="bg-white shadow-md border-b-4 border-green-500 z-10">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16 items-center">
                <div class="flex items-center">
                    <i class="fa-solid fa-leaf text-green-500 text-2xl mr-3"></i>
                    <h1 class="text-2xl font-bold text-gray-900 hidden sm:block">森林数学大冒险 <span class="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full ml-2 border border-gray-200">智能特训版</span></h1>
                </div>
                <div class="flex items-center space-x-2 sm:space-x-4 overflow-x-auto hide-scrollbar">
                    <!-- 音乐控制按钮 -->
                    <button id="music-toggle" onclick="window.toggleMusic()" class="text-gray-500 hover:text-green-500 transition-colors p-2 rounded-full hover:bg-green-50" title="背景音乐">
                        <i class="fa-solid fa-music text-xl"></i>
                    </button>
                    <!-- 全屏按钮 -->
                    <button id="fullscreen-toggle" onclick="window.toggleFullscreen()" class="text-gray-500 hover:text-blue-500 transition-colors p-2 rounded-full hover:bg-blue-50" title="全屏模式">
                        <i class="fa-solid fa-expand text-xl"></i>
                    </button>
                    <!-- 主页按钮 -->
                    <button onclick="window.goHome()" class="text-gray-500 hover:text-purple-500 transition-colors p-2 rounded-full hover:bg-purple-50" title="返回首页">
                        <i class="fa-solid fa-house text-xl"></i>
                    </button>
                    <div class="w-px h-6 bg-gray-300 mx-1"></div>
                    <button onclick="window.switchTab('review')" id="tab-review" class="tab-active whitespace-nowrap px-3 py-2 text-lg transition-colors flex items-center">
                        <i class="fa-solid fa-brain mr-2"></i> 记忆特训
                    </button>
                    <button onclick="window.switchTab('home')" id="tab-home" class="tab-inactive whitespace-nowrap px-3 py-2 text-lg transition-colors flex items-center">
                        <i class="fa-solid fa-book mr-1"></i> 题库浏览
                    </button>
                </div>
            </div>
        </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div class="max-w-4xl mx-auto h-full">
            
            <!-- Home: Question List -->
            <div id="view-home" class="hidden fade-in space-y-6">
                <div class="bg-white rounded-[2rem] shadow-xl p-8 border-4 border-green-400 relative overflow-hidden">
                    <div class="absolute top-[-20px] right-[-20px] text-8xl opacity-10">🐻</div>
                    <h2 class="text-2xl font-bold text-gray-900 mb-2"><i class="fa-solid fa-calculator mr-2 text-green-500"></i>艾宾浩斯错题拦截系统</h2>
                    <p class="text-gray-600 text-lg mb-4 font-medium">
                        欢迎来到智慧森林！这里收录了 <span id="home-q-count" class="text-green-600 font-bold text-xl"></span> 道找规律与逻辑推理题。<br>
                        系统使用记忆遗忘曲线算法，帮你自动捕捉易错题，适时提醒复习，让你成为真正的数学小侦探！
                    </p>
                    <div class="flex items-center space-x-4 text-sm text-gray-500 font-bold bg-green-50 p-3 rounded-xl inline-flex">
                        <span><i class="fa-solid fa-cloud text-blue-500 mr-1"></i> 云端保存</span>
                        <span><i class="fa-solid fa-clock text-orange-500 mr-1"></i> 智能提醒</span>
                        <span><i class="fa-solid fa-chart-line text-purple-500 mr-1"></i> 学习追踪</span>
                    </div>
                </div>

                <div class="bg-white rounded-[1.5rem] shadow-lg overflow-hidden border-2 border-gray-100">
                    <div class="bg-blue-50 px-6 py-4 border-b border-blue-100 flex justify-between items-center">
                        <h3 class="font-bold text-blue-800 text-lg">📚 智慧题库概览</h3>
                    </div>
                    <div class="p-4 space-y-4 max-h-[50vh] overflow-y-auto" id="question-list">
                        <!-- Questions will be injected here -->
                    </div>
                </div>
            </div>

            <!-- Review Mode: Quiz -->
            <div id="view-review" class="fade-in h-full flex flex-col items-center justify-center pt-2 sm:pt-8">
                
                <!-- Start Screen -->
                <div id="quiz-start" class="text-center max-w-lg w-full px-4">
                    <div class="bg-white p-6 sm:p-10 rounded-[2.5rem] shadow-2xl border-4 border-yellow-400 relative overflow-hidden">
                        <div class="text-7xl mb-4">🦁</div>
                        <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">准备探险！</h2>
                        <p class="text-gray-600 mb-6 font-medium">题库共有 <span class="font-bold text-yellow-600 text-xl" id="total-questions-count">0</span> 道题，分 <span class="font-bold text-green-600">4</span> 个单元。</p>
                        
                        <div id="ebbinghaus-status" class="mb-4 sm:mb-6">
                            <div class="inline-block bg-purple-50 text-purple-700 px-4 py-2 rounded-xl font-bold text-sm shadow-sm border border-purple-100">
                                <i class="fa-solid fa-hourglass-half mr-1"></i> <span id="sync-status">正在连接云端记忆库...</span>
                            </div>
                        </div>

                        <!-- User Selection -->
                        <div class="mb-4 text-left bg-gray-50 p-4 rounded-2xl border-2 border-gray-200">
                            <label class="block text-sm font-bold text-gray-700 mb-2">
                                <i class="fa-solid fa-user-graduate mr-1 text-blue-500"></i> 选择用户角色:
                            </label>
                            <select id="user-profile" onchange="window.changeProfile()" class="block w-full rounded-xl border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-base p-3 border bg-white font-bold text-gray-700">
                                <option value="user10001">👤 user10001</option>
                                <option value="user10002">👤 user10002</option>
                                <option value="user10003">👤 user10003</option>
                                <option value="user12345">👤 user12345</option>
                                <option value="user88888">👤 user88888</option>
                            </select>
                        </div>
                        
                        <!-- Unit Selection -->
                        <div class="mb-4 text-left bg-gray-50 p-4 rounded-2xl border-2 border-gray-200">
                            <label class="block text-sm font-bold text-gray-700 mb-2">
                                <i class="fa-solid fa-book-open mr-1 text-purple-500"></i> 选择学习单元:
                            </label>
                            <select id="unit-select" onchange="window.changeUnit()" class="block w-full rounded-xl border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-base p-3 border bg-white font-bold text-gray-700">
                                <option value="all">📚 全部单元 (52题)</option>
                                <option value="第1单元">📗 第1单元：20以内数的加减法(二) (23题)</option>
                                <option value="第2单元">📘 第2单元：100以内的数 (14题)</option>
                                <option value="第3单元">📙 第3单元：时间的初步认识 (5题)</option>
                                <option value="第4单元">📕 第4单元：100以内数的加减法(一) (10题)</option>
                            </select>
                        </div>
                        
                        <!-- Daily Limit Setting -->
                        <div class="mb-8 text-left bg-gray-50 p-4 rounded-2xl border-2 border-gray-200">
                            <label for="daily-limit" class="block text-sm font-bold text-gray-700 mb-2">
                                <i class="fa-solid fa-bullseye mr-1 text-red-500"></i> 今日挑战目标:
                            </label>
                            <div class="flex items-center space-x-3">
                                <select id="daily-limit" class="block w-full rounded-xl border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-base p-3 border bg-white font-bold text-gray-700">
                                    <option value="5">5 题 (热身)</option>
                                    <option value="10" selected>10 题 (标准)</option>
                                    <option value="20">20 题 (进阶)</option>
                                    <option value="52">全部 52 题 (大师)</option>
                                </select>
                            </div>
                        </div>

                        <button id="btn-start" onclick="window.prepareQuiz()" class="w-full bg-green-500 text-white py-4 px-6 rounded-2xl text-xl font-bold hover:bg-green-600 transition shadow-[0_6px_0_#16a34a] active:shadow-none active:translate-y-2">
                            开始今日闯关 ▶️
                        </button>
                        
                        <button onclick="window.showMemoryDashboard()" class="w-full mt-4 bg-white text-purple-500 border-2 border-purple-200 py-3 px-6 rounded-2xl font-bold hover:bg-purple-50 transition">
                            <i class="fa-solid fa-database mr-1"></i> 查看我的错题库
                        </button>
                    </div>
                </div>

                <!-- Pre-Review Screen -->
                <div id="quiz-pre-review" class="hidden w-full max-w-2xl px-4">
                    <div class="bg-white rounded-[2rem] shadow-2xl border-8 border-yellow-400 overflow-hidden flex flex-col max-h-[85vh]">
                        <div class="p-5 bg-yellow-100 flex items-center justify-between sticky top-0 border-b-4 border-yellow-200">
                            <h3 class="text-xl font-bold text-yellow-800"><i class="fa-solid fa-bolt mr-2 text-yellow-600"></i> 记忆突击: 错题拦截！</h3>
                            <span class="text-sm bg-yellow-300 text-yellow-900 px-3 py-1 rounded-full font-bold">艾宾浩斯复习提醒</span>
                        </div>
                        <div class="p-6 overflow-y-auto flex-1 bg-yellow-50/50">
                            <p class="text-gray-700 mb-6 text-base font-bold">系统检测到你有 <span id="pre-review-count" class="text-red-500 text-xl font-black"></span> 道题快要忘记了！请在闯关前先复习一下：</p>
                            <div id="pre-review-list" class="space-y-4"></div>
                        </div>
                        <div class="p-5 bg-white border-t-4 border-gray-100 mt-auto">
                            <button onclick="window.enterQuizContext()" class="w-full bg-yellow-500 text-white py-4 px-6 rounded-2xl text-xl font-bold hover:bg-yellow-600 transition shadow-[0_6px_0_#ca8a04] active:shadow-none active:translate-y-2 flex justify-center items-center">
                                我记住了，开始闯关！ <i class="fa-solid fa-rocket ml-2"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Quiz Card -->
                <div id="quiz-container" class="hidden w-full max-w-3xl px-2 sm:px-4">
                    <div class="flex justify-between items-center mb-3 sm:mb-4">
                        <span class="text-sm sm:text-base font-bold text-green-600 bg-green-100 px-3 py-1 rounded-full">进度: <span id="current-q">1</span>/<span id="total-q">10</span></span>
                        <div class="h-3 sm:h-4 w-1/2 bg-gray-200 rounded-full overflow-hidden border-2 border-gray-300">
                            <div id="progress-bar" class="h-full bg-green-500 transition-all duration-300" style="width: 0%"></div>
                        </div>
                    </div>

                    <div class="bg-white rounded-3xl sm:rounded-[2.5rem] shadow-2xl border-4 sm:border-8 border-blue-400 overflow-hidden relative flex flex-col max-h-[80vh] sm:max-h-none">
                        <div class="p-4 sm:p-6 lg:p-10 flex-1 overflow-y-auto">
                            <div class="mb-3 sm:mb-4 flex flex-wrap items-center gap-2">
                                <span id="q-year" class="inline-block px-3 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700"></span>
                                <span id="q-tag" class="inline-block px-3 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700"></span>
                                <span id="ebbinghaus-badge" class="hidden inline-block px-3 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200">
                                    <i class="fa-solid fa-rotate-left mr-1"></i> 复习
                                </span>
                            </div>

                            <div class="bg-blue-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 border-blue-100 mb-4 sm:mb-6 flex items-center justify-center text-center">
                                <h3 class="text-lg sm:text-xl lg:text-2xl text-gray-800 font-bold leading-relaxed whitespace-pre-wrap" id="q-question"></h3>
                            </div>
                            
                            <div class="mb-2">
                                <div id="options-container" class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4"></div>
                            </div>
                        </div>

                        <!-- Feedback Area -->
                        <div id="feedback-area" class="hidden bg-gradient-to-r from-green-50 to-blue-50 p-3 sm:p-4 border-t-4 border-green-400">
                            <div class="flex items-start">
                                <div id="feedback-icon" class="flex-shrink-0 mr-3 sm:mr-4"></div>
                                <div class="flex-1 min-w-0">
                                    <h4 id="feedback-title" class="font-bold text-base sm:text-lg mb-2"></h4>
                                    <div id="feedback-content" class="text-gray-700 text-sm space-y-2 bg-white/80 p-3 rounded-xl border border-green-100">
                                        <p class="leading-relaxed"><strong class="text-green-600"><i class="fa-solid fa-lightbulb"></i> 解析：</strong><span id="feedback-explanation"></span></p>
                                        <p class="leading-relaxed"><strong class="text-orange-500"><i class="fa-solid fa-circle-exclamation"></i> 易错：</strong><span id="feedback-error"></span></p>
                                    </div>
                                    <button onclick="window.nextQuestion()" class="mt-3 w-full bg-blue-500 text-white px-4 py-2 rounded-xl text-base font-bold shadow-[0_4px_0_#2563eb] active:shadow-none active:translate-y-1 transition-all">
                                        下一题 <i class="fa-solid fa-arrow-right ml-1"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Results Screen -->
                <div id="quiz-results" class="hidden text-center max-w-lg w-full px-4">
                    <div class="bg-white p-8 sm:p-12 rounded-[3rem] shadow-2xl border-8 border-pink-400 relative">
                        <div class="absolute -top-10 left-1/2 transform -translate-x-1/2 text-7xl">🎉</div>
                        <h2 class="text-3xl font-bold text-pink-500 mb-4 mt-4">太棒啦！</h2>
                        <p class="text-gray-600 mb-2 text-xl font-bold">今日得分: <span id="final-score" class="text-5xl font-black text-amber-500 block mt-2"></span></p>
                        
                        <!-- 邮件发送状态 -->
                        <div id="email-status" class="text-base font-medium mb-6 min-h-[28px]"></div>
                        
                        <div class="flex flex-col space-y-4 justify-center">
                            <button onclick="window.switchTab('review'); document.getElementById('quiz-results').classList.add('hidden'); document.getElementById('quiz-start').classList.remove('hidden');" class="bg-green-500 text-white py-4 px-6 rounded-full text-xl font-bold hover:bg-green-600 shadow-[0_6px_0_#16a34a] active:shadow-none active:translate-y-2">
                                🔄 返回首页
                            </button>
                            <button onclick="window.showMemoryDashboard()" class="bg-purple-100 text-purple-600 border-2 border-purple-200 py-4 px-6 rounded-full text-xl font-bold hover:bg-purple-200">
                                📊 查看记忆进度
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </main>

    <!-- Database Modal -->
    <div id="memory-modal" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl fade-in overflow-hidden border-4 border-purple-300">
            <div class="flex justify-between items-center p-6 bg-purple-600 text-white">
                <h3 class="text-xl font-bold flex items-center">
                    <i class="fa-solid fa-database mr-3 text-yellow-300"></i>
                    <span id="memory-modal-title">我的记忆数据库</span>
                </h3>
                <div class="flex items-center space-x-4">
                    <button onclick="window.clearAllMemory()" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition flex items-center shadow-sm">
                        <i class="fa-solid fa-trash-can mr-2"></i> 清洗数据
                    </button>
                    <button onclick="document.getElementById('memory-modal').classList.add('hidden')" class="text-purple-200 hover:text-white transition bg-purple-700 rounded-full w-8 h-8 flex justify-center items-center">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
            </div>

            <div class="overflow-y-auto flex-1 bg-white p-2">
                <table class="min-w-full db-table text-left border-collapse">
                    <thead class="sticky top-0 bg-purple-50 shadow-sm z-10">
                        <tr>
                            <th class="px-4 py-4 border-b-2 border-purple-100 font-bold text-purple-800 rounded-tl-lg">题目信息</th>
                            <th class="px-4 py-4 border-b-2 border-purple-100 text-center font-bold text-purple-800">状态</th>
                            <th class="px-4 py-4 border-b-2 border-purple-100 text-center font-bold text-purple-800">记忆等级</th>
                            <th class="px-4 py-4 border-b-2 border-purple-100 font-bold text-purple-800 rounded-tr-lg">下次复习时间</th>
                        </tr>
                    </thead>
                    <tbody id="db-table-body" class="divide-y divide-purple-50">
                        <!-- Rows injected by JS -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 前端逻辑 -->
    <script>
        // 数学题库数据通过模板字面量注入
        const mistakeDatabase = ${JSON.stringify(mathQuestions)};

        let userRecords = []; 
        let currentProfile = 'user10001';
        let currentQuestionIndex = 0;
        let score = 0;
        let quizData = [];
        let isAnswered = false;
        
        // 用于存储单次复习的做题明细，用于邮件发送
        let sessionLog = [];
        
        // 当前选择的单元
        let currentUnit = 'all';
        
        // 背景音乐控制
        let isMusicPlaying = false;
        const bgMusic = document.getElementById('bg-music');
        const musicToggleBtn = document.getElementById('music-toggle');
        
        window.toggleMusic = function() {
            if (!bgMusic) return;
            
            if (isMusicPlaying) {
                bgMusic.pause();
                isMusicPlaying = false;
                musicToggleBtn.innerHTML = '<i class="fa-solid fa-music text-xl"></i>';
                musicToggleBtn.classList.remove('text-green-500', 'bg-green-50');
                musicToggleBtn.classList.add('text-gray-500');
            } else {
                bgMusic.volume = 0.3; // 设置音量为30%
                bgMusic.play().then(() => {
                    isMusicPlaying = true;
                    musicToggleBtn.innerHTML = '<i class="fa-solid fa-volume-high text-xl"></i>';
                    musicToggleBtn.classList.remove('text-gray-500');
                    musicToggleBtn.classList.add('text-green-500', 'bg-green-50');
                }).catch(e => {
                    console.log('音乐播放需要用户交互:', e);
                    alert('请点击页面任意位置后再开启音乐~');
                });
            }
        };
        
        // 首次点击页面任意位置时尝试播放音乐
        document.addEventListener('click', function initMusic() {
            if (!isMusicPlaying && bgMusic && bgMusic.paused) {
                bgMusic.volume = 0.2;
                bgMusic.play().then(() => {
                    isMusicPlaying = true;
                    musicToggleBtn.innerHTML = '<i class="fa-solid fa-volume-high text-xl"></i>';
                    musicToggleBtn.classList.remove('text-gray-500');
                    musicToggleBtn.classList.add('text-green-500', 'bg-green-50');
                }).catch(() => {});
            }
            document.removeEventListener('click', initMusic);
        }, { once: true });
        
        // ==================== 全屏功能 ====================
        let isFullscreen = false;
        const fullscreenBtn = document.getElementById('fullscreen-toggle');
        
        window.toggleFullscreen = function() {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                // 进入全屏
                const elem = document.documentElement;
                if (elem.requestFullscreen) {
                    elem.requestFullscreen();
                } else if (elem.webkitRequestFullscreen) {
                    elem.webkitRequestFullscreen();
                } else if (elem.msRequestFullscreen) {
                    elem.msRequestFullscreen();
                }
            } else {
                // 退出全屏
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
            }
        };
        
        // 监听全屏状态变化，更新图标
        function updateFullscreenIcon() {
            isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            if (fullscreenBtn) {
                if (isFullscreen) {
                    fullscreenBtn.innerHTML = '<i class="fa-solid fa-compress text-xl"></i>';
                    fullscreenBtn.classList.remove('text-gray-500');
                    fullscreenBtn.classList.add('text-blue-500', 'bg-blue-50');
                } else {
                    fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand text-xl"></i>';
                    fullscreenBtn.classList.remove('text-blue-500', 'bg-blue-50');
                    fullscreenBtn.classList.add('text-gray-500');
                }
            }
        }
        
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
        
        // ==================== 返回主页功能 ====================
        window.goHome = function() {
            // 停止背景音乐
            if (bgMusic && isMusicPlaying) {
                bgMusic.pause();
                isMusicPlaying = false;
                musicToggleBtn.innerHTML = '<i class="fa-solid fa-music text-xl"></i>';
                musicToggleBtn.classList.remove('text-green-500', 'bg-green-50');
                musicToggleBtn.classList.add('text-gray-500');
            }
            
            // 退出全屏
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            }
            
            // 重置到首页（记忆特训）
            window.switchTab('review');
            
            // 重置测验状态
            document.getElementById('quiz-container').classList.add('hidden');
            document.getElementById('quiz-results').classList.add('hidden');
            document.getElementById('quiz-pre-review').classList.add('hidden');
            document.getElementById('quiz-start').classList.remove('hidden');
            
            // 重置分数和索引
            currentQuestionIndex = 0;
            score = 0;
            sessionLog = [];
        };

        // 艾宾浩斯遗忘曲线间隔 (毫秒)
        const EBBINGHAUS_INTERVALS = [
            0, 
            5 * 60 * 1000,           // Lv.1: 5分钟
            30 * 60 * 1000,          // Lv.2: 30分钟
            12 * 60 * 60 * 1000,     // Lv.3: 12小时
            24 * 60 * 60 * 1000,     // Lv.4: 1天
            2 * 24 * 60 * 60 * 1000, // Lv.5: 2天
            4 * 24 * 60 * 60 * 1000, // Lv.6: 4天
            7 * 24 * 60 * 60 * 1000, // Lv.7: 7天
            15 * 24 * 60 * 60 * 1000,// Lv.8: 15天
            30 * 24 * 60 * 60 * 1000 // Lv.9: 30天 (Mastered)
        ];

        document.getElementById('total-questions-count').innerText = mistakeDatabase.length;
        document.getElementById('home-q-count').innerText = mistakeDatabase.length;

        // 初始化环境与数据库连接
        async function initApp() {
            await fetchMemoryRecords();
            renderQuestionList();
        }

        // 渲染题目列表 (首页大厅)
        function renderQuestionList() {
            const container = document.getElementById('question-list');
            let html = '';
            mistakeDatabase.forEach(q => {
                html += \`
                    <div class="bg-white p-5 rounded-2xl border-2 border-blue-100 hover:border-blue-300 transition-colors">
                        <div class="flex items-start justify-between mb-3">
                            <div class="flex gap-2">
                                <span class="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full">\${q.year}</span>
                                <span class="inline-block bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">\${q.tag}</span>
                            </div>
                            <span class="text-xs text-gray-400 font-bold bg-gray-100 px-2 py-1 rounded-full">#\${q.id}</span>
                        </div>
                        <h4 class="font-bold text-gray-800 mb-2">\${q.title}</h4>
                        <p class="text-sm text-gray-600 line-clamp-2 bg-gray-50 p-2 rounded-lg">\${q.question}</p>
                    </div>
                \`;
            });
            container.innerHTML = html;
        }

        // 调用 Cloudflare API: 拉取记忆记录
        async function fetchMemoryRecords() {
            try {
                const response = await fetch('/api/memory/get?userProfile=' + currentProfile);
                if (!response.ok) throw new Error('API Request Failed');
                userRecords = await response.json();
                updateSyncUI();
            } catch(e) {
                console.error("Fetch Data Error", e);
                document.getElementById('sync-status').innerHTML = '<span class="text-red-500"><i class="fa-solid fa-xmark"></i> 连接云端失败</span>';
            }
        }

        function updateSyncUI() {
            const now = Date.now();
            const dueCount = userRecords.filter(r => r.nextReviewTime <= now).length;
            const syncUI = document.getElementById('sync-status');
            syncUI.innerHTML = '<span class="text-green-600"><i class="fa-solid fa-cloud-arrow-down"></i> 云端已同步 | <b class="text-red-500">' + dueCount + '</b> 题待复习</span>';
        }

        // 调用 Cloudflare API: 触发算法更新数据库
        async function updateMemoryRecord(questionId, isCorrect) {
            try {
                const existingIndex = userRecords.findIndex(r => r.questionId === questionId);
                const existing = existingIndex !== -1 ? userRecords[existingIndex] : null;
                const now = Date.now();
                let newData;

                if (!existing) {
                    if (!isCorrect) {
                        newData = { questionId: questionId, level: 1, nextReviewTime: now + EBBINGHAUS_INTERVALS[1] };
                    }
                } else {
                    if (isCorrect) {
                        const nextLevel = Math.min(existing.level + 1, EBBINGHAUS_INTERVALS.length - 1);
                        newData = { questionId: questionId, level: nextLevel, nextReviewTime: now + EBBINGHAUS_INTERVALS[nextLevel] };
                    } else {
                        newData = { questionId: questionId, level: 1, nextReviewTime: now + EBBINGHAUS_INTERVALS[1] };
                    }
                }

                if (newData) {
                    if (existingIndex !== -1) {
                        userRecords[existingIndex] = newData;
                    } else {
                        userRecords.push(newData);
                    }
                    
                    await fetch('/api/memory/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userProfile: currentProfile,
                            questionId: newData.questionId,
                            level: newData.level,
                            nextReviewTime: newData.nextReviewTime
                        })
                    });
                }
            } catch(e) {
                console.error("Update DB Failed", e);
            }
        }

        window.changeProfile = async function() {
            const profileSelect = document.getElementById('user-profile');
            currentProfile = profileSelect.value;
            document.getElementById('sync-status').innerHTML = '<span class="text-purple-600"><i class="fa-solid fa-spinner fa-spin"></i> 读取数据中...</span>';
            await fetchMemoryRecords();
        };
        
        window.changeUnit = function() {
            const unitSelect = document.getElementById('unit-select');
            currentUnit = unitSelect.value;
            
            // 更新题目数量统计
            let filteredQuestions = currentUnit === 'all' 
                ? mistakeDatabase 
                : mistakeDatabase.filter(q => q.year === currentUnit);
            
            document.getElementById('total-questions-count').innerText = filteredQuestions.length;
            
            // 更新下拉选项中的题目数量显示
            const unitCounts = {
                'all': mistakeDatabase.length,
                '第1单元': mistakeDatabase.filter(q => q.year === '第1单元').length,
                '第2单元': mistakeDatabase.filter(q => q.year === '第2单元').length,
                '第3单元': mistakeDatabase.filter(q => q.year === '第3单元').length,
                '第4单元': mistakeDatabase.filter(q => q.year === '第4单元').length
            };
            
            // 根据选择的单元更新每日目标选项
            const limitSelect = document.getElementById('daily-limit');
            const maxQuestions = unitCounts[currentUnit];
            
            // 更新"全部题目"选项的文字
            let allOption = limitSelect.querySelector('option[value="52"]');
            if (!allOption) {
                // 如果找不到52题的选项，找最后一个选项
                allOption = limitSelect.options[limitSelect.options.length - 1];
            }
            allOption.value = maxQuestions;
            allOption.text = '全部 ' + maxQuestions + ' 题 (大师)';
        };

        window.switchTab = function(tabName) {
            ['view-home', 'view-review'].forEach(id => {
                document.getElementById(id).classList.add('hidden');
            });
            ['tab-home', 'tab-review'].forEach(id => {
                document.getElementById(id).className = "tab-inactive whitespace-nowrap px-3 py-2 text-lg transition-colors flex items-center cursor-pointer";
            });
            document.getElementById('view-' + tabName).classList.remove('hidden');
            document.getElementById('tab-' + tabName).className = "tab-active whitespace-nowrap px-3 py-2 text-lg transition-colors flex items-center cursor-pointer";
        };

        window.clearAllMemory = async function() {
            if (!confirm('确定要清除 [' + currentProfile + '] 的所有记忆数据吗？此操作不可恢复！')) return;
            
            try {
                const response = await fetch('/api/memory/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userProfile: currentProfile })
                });
                
                if (!response.ok) throw new Error('Clear Failed');
                
                userRecords = [];
                updateSyncUI();
                window.showMemoryDashboard();
                alert('数据已全部清除！');
            } catch(e) {
                console.error(e);
                alert('清除失败，请检查网络或后端配置。');
            }
        };

        function shuffleArray(array) {
            let arr = [...array];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        window.prepareQuiz = function() {
            const limitVal = parseInt(document.getElementById('daily-limit').value) || 10;
            const now = Date.now();
            
            // 根据选择的单元筛选题目
            let unitQuestions = currentUnit === 'all' 
                ? mistakeDatabase 
                : mistakeDatabase.filter(q => q.year === currentUnit);
            
            const dueQuestionIds = userRecords.filter(r => r.nextReviewTime <= now).map(r => r.questionId);
            
            let dueQuestions = unitQuestions.filter(q => dueQuestionIds.includes(q.id));
            let newQuestions = unitQuestions.filter(q => !dueQuestionIds.includes(q.id));
            
            dueQuestions = shuffleArray(dueQuestions);
            newQuestions = shuffleArray(newQuestions);

            quizData = [...dueQuestions, ...newQuestions].slice(0, Math.min(limitVal, unitQuestions.length));
            
            document.getElementById('quiz-start').classList.add('hidden');
            document.getElementById('quiz-results').classList.add('hidden');
            
            if (dueQuestions.length > 0) {
                showPreReviewScreen(dueQuestions);
            } else {
                window.enterQuizContext();
            }
        };

        function showPreReviewScreen(dueList) {
            const listContainer = document.getElementById('pre-review-list');
            document.getElementById('pre-review-count').innerText = dueList.length;
            listContainer.innerHTML = '';

            dueList.forEach(q => {
                const dbRecord = userRecords.find(r => r.questionId === q.id);
                const lvl = dbRecord ? dbRecord.level : 1;
                listContainer.innerHTML += 
                    '<div class="bg-white p-5 rounded-2xl border-2 border-yellow-300 shadow-md relative overflow-hidden">' +
                        '<div class="absolute right-0 top-0 bg-yellow-400 text-yellow-900 text-xs px-3 py-1 rounded-bl-xl font-bold">' +
                            '记忆等级 Lv.' + lvl +
                        '</div>' +
                        '<div class="flex items-center gap-2 mb-3">' +
                            '<span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">' + q.year + '</span>' +
                            '<span class="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded">' + q.tag + '</span>' +
                        '</div>' +
                        '<h4 class="font-bold text-gray-800 text-lg mb-2">' + q.title + '</h4>' +
                        '<p class="text-gray-600 mb-3 bg-gray-50 p-2 rounded-lg">' + q.question + '</p>' +
                        '<div class="bg-green-50 p-3 rounded-xl text-sm border border-green-100">' +
                            '<strong class="text-green-700"><i class="fa-solid fa-key"></i> 正确答案：</strong><span class="font-bold text-lg text-green-600 ml-2">' + q.keyPoint + '</span>' +
                        '</div>' +
                    '</div>';
            });
            document.getElementById('quiz-pre-review').classList.remove('hidden');
        }

        window.enterQuizContext = function() {
            document.getElementById('quiz-pre-review').classList.add('hidden');
            document.getElementById('quiz-container').classList.remove('hidden');
            
            sessionLog = []; // 清空答题日志
            currentQuestionIndex = 0;
            score = 0;
            document.getElementById('total-q').innerText = quizData.length;
            loadQuestion();
        };

        function loadQuestion() {
            isAnswered = false;
            const q = quizData[currentQuestionIndex];
            
            const isReviewQuestion = userRecords.some(r => r.questionId === q.id && r.nextReviewTime <= Date.now());
            document.getElementById('ebbinghaus-badge').style.display = isReviewQuestion ? 'inline-flex' : 'none';

            document.getElementById('current-q').innerText = currentQuestionIndex + 1;
            document.getElementById('progress-bar').style.width = (((currentQuestionIndex) / quizData.length) * 100) + '%';
            
            document.getElementById('q-year').innerText = q.year;
            document.getElementById('q-tag').innerText = q.tag;
            document.getElementById('q-question').innerText = q.question;
            document.getElementById('feedback-area').classList.add('hidden');

            const optionsDiv = document.getElementById('options-container');
            optionsDiv.innerHTML = '';

            // 直接使用数学题目中原有的选项
            let options = q.options.map(opt => ({
                text: String(opt),
                isCorrect: String(opt) === String(q.keyPoint)
            }));
            options = shuffleArray(options);

            const colors = ['bg-yellow-400 shadow-[0_6px_0_#b45309]', 'bg-blue-400 shadow-[0_6px_0_#1d4ed8]', 'bg-pink-400 shadow-[0_6px_0_#be185d]'];

            options.forEach((opt, idx) => {
                const btn = document.createElement('div');
                const baseColor = colors[idx % colors.length];
                
                // 手机模式下更紧凑的样式
                btn.className = \`option-card w-full py-4 sm:py-6 px-3 sm:px-4 rounded-2xl sm:rounded-3xl cursor-pointer flex items-center justify-center text-center text-xl sm:text-2xl font-bold text-white transition-all \${baseColor} active:translate-y-1 sm:active:translate-y-2 active:shadow-none\`;
                btn.innerHTML = '<span class="leading-snug">' + opt.text + '</span>';
                btn.onclick = () => window.checkAnswer(opt, btn, q, baseColor);
                optionsDiv.appendChild(btn);
            });
        }

        window.checkAnswer = async function(selectedOption, btnElement, questionData, baseColor) {
            if (isAnswered) return;
            isAnswered = true;

            const allBtns = document.getElementById('options-container').children;
            
            // 记录答题日志
            sessionLog.push({
                year: questionData.year,
                tag: questionData.tag,
                title: questionData.title,
                question: questionData.question,
                keyPoint: questionData.keyPoint,
                commonError: questionData.commonError,
                isCorrect: selectedOption.isCorrect
            });

            if (selectedOption.isCorrect) {
                score++;
                btnElement.className = "option-card w-full py-4 sm:py-6 px-3 sm:px-4 rounded-2xl sm:rounded-3xl flex items-center justify-center text-center text-xl sm:text-2xl font-bold text-white transition-all bg-green-500 shadow-[0_4px_0_#16a34a] sm:shadow-[0_6px_0_#16a34a] transform scale-105";
                btnElement.innerHTML = '<i class="fa-solid fa-check-circle mr-1 sm:mr-2 text-2xl sm:text-3xl"></i><span class="leading-snug">' + selectedOption.text + '</span>';
                showFeedback(true, questionData, true); // 第三个参数表示是否自动下一题
            } else {
                btnElement.className = "option-card w-full py-4 sm:py-6 px-3 sm:px-4 rounded-2xl sm:rounded-3xl flex items-center justify-center text-center text-xl sm:text-2xl font-bold text-white transition-all bg-gray-400 shadow-none opacity-80";
                btnElement.innerHTML = '<i class="fa-solid fa-times-circle mr-1 sm:mr-2 text-2xl sm:text-3xl"></i><span class="leading-snug">' + selectedOption.text + '</span>';
                
                // 找出正确答案并高亮
                Array.from(allBtns).forEach(b => {
                    if (b.innerText === questionData.keyPoint) {
                        b.className = "option-card w-full py-4 sm:py-6 px-3 sm:px-4 rounded-2xl sm:rounded-3xl flex items-center justify-center text-center text-xl sm:text-2xl font-bold text-white transition-all bg-green-500 shadow-[0_4px_0_#16a34a] sm:shadow-[0_6px_0_#16a34a] animate-pulse";
                    }
                });
                showFeedback(false, questionData, false);
            }

            await updateMemoryRecord(questionData.id, selectedOption.isCorrect);
            updateSyncUI();
            
            // 答对后自动进入下一题
            if (selectedOption.isCorrect) {
                setTimeout(() => {
                    window.nextQuestion();
                }, 1500); // 1.5秒后自动下一题
            }
        };

        function showFeedback(isCorrect, data, autoNext = false) {
            const fbArea = document.getElementById('feedback-area');
            const fbIcon = document.getElementById('feedback-icon');
            const fbTitle = document.getElementById('feedback-title');
            const nextBtn = fbArea.querySelector('button');
            
            document.getElementById('feedback-error').innerText = data.commonError;
            document.getElementById('feedback-explanation').innerText = data.explanation;

            fbArea.classList.remove('hidden');
            fbArea.classList.add('fade-in');
            
            // 控制下一题按钮显示/隐藏
            if (nextBtn) {
                nextBtn.style.display = autoNext ? 'none' : 'block';
                if (autoNext) {
                    nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 自动进入下一题...';
                    nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    nextBtn.innerHTML = '下一题 <i class="fa-solid fa-arrow-right ml-2"></i>';
                    nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }

            if (isCorrect) {
                fbIcon.innerHTML = '<div class="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-green-100 flex items-center justify-center shadow-inner flex-shrink-0"><i class="fa-solid fa-check text-green-500 text-xl sm:text-2xl"></i></div>';
                fbTitle.innerText = "太棒了！";
                fbTitle.className = "font-bold text-lg sm:text-xl mb-1 text-green-600";
            } else {
                fbIcon.innerHTML = '<div class="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-red-100 flex items-center justify-center shadow-inner flex-shrink-0"><i class="fa-solid fa-xmark text-red-500 text-xl sm:text-2xl"></i></div>';
                fbTitle.innerText = "再想想看~";
                fbTitle.className = "font-bold text-lg sm:text-xl mb-1 text-red-500";
            }
        }

        window.nextQuestion = function() {
            currentQuestionIndex++;
            if (currentQuestionIndex < quizData.length) {
                loadQuestion();
            } else {
                showResults();
            }
        };

        function showResults() {
            document.getElementById('quiz-container').classList.add('hidden');
            document.getElementById('quiz-results').classList.remove('hidden');
            document.getElementById('final-score').innerText = score + ' / ' + quizData.length;
            
            // 发送邮件报告
            const emailStatus = document.getElementById('email-status');
            emailStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-blue-500"></i> <span class="text-blue-600">正在生成报告并发送邮件...</span>';

            fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profile: currentProfile,
                    score: score,
                    total: quizData.length,
                    logs: sessionLog
                })
            }).then(res => res.json()).then(data => {
                if(data.success) {
                    emailStatus.innerHTML = '<i class="fa-solid fa-check-circle text-green-500 text-lg mr-1"></i> <span class="text-green-600">学习报告已发送到邮箱！</span>';
                } else {
                    emailStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-red-500 mr-1"></i> <span class="text-red-500">邮件发送失败：' + (data.error || '未知错误') + '</span>';
                }
            }).catch(e => {
                emailStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-red-500 mr-1"></i> <span class="text-red-500">系统错误，无法发送邮件。</span>';
            });
        }

        window.showMemoryDashboard = function() {
            const modal = document.getElementById('memory-modal');
            const tbody = document.getElementById('db-table-body');
            
            if (userRecords.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-gray-500 font-bold bg-gray-50">还没有错题记录哦！快去闯关吧！🚀</td></tr>';
            } else {
                let html = '';
                const sorted = [...userRecords].sort((a,b) => a.nextReviewTime - b.nextReviewTime);
                const now = Date.now();

                sorted.forEach(record => {
                    const q = mistakeDatabase.find(x => x.id === record.questionId);
                    if(!q) return;

                    const dateObj = new Date(record.nextReviewTime);
                    const timeStr = dateObj.getFullYear() + '-' + 
                                    (dateObj.getMonth()+1).toString().padStart(2,'0') + '-' + 
                                    dateObj.getDate().toString().padStart(2,'0') + ' ' + 
                                    dateObj.getHours().toString().padStart(2,'0') + ':' + 
                                    dateObj.getMinutes().toString().padStart(2,'0');
                    
                    const isDue = record.nextReviewTime <= now;
                    const statusHtml = isDue 
                        ? '<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold border border-red-200">急需复习</span>' 
                        : '<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold border border-green-200">记忆巩固中</span>';

                    const timeClass = isDue ? 'text-red-500 font-bold' : 'text-gray-500';

                    html += 
                    '<tr class="hover:bg-purple-50 transition">' +
                        '<td class="px-4 py-4 border-b border-purple-100 max-w-xs">' +
                            '<span class="font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded text-xs mr-2">' + q.year + '</span>' + 
                            '<span class="font-bold text-gray-800">' + q.title + '</span><br>' +
                            '<span class="text-xs text-gray-500 mt-1 inline-block truncate w-full">' + q.question + '</span>' +
                        '</td>' +
                        '<td class="px-4 py-4 border-b border-purple-100 text-center">' + statusHtml + '</td>' +
                        '<td class="px-4 py-4 border-b border-purple-100 text-center">' +
                            '<div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-yellow-100 text-yellow-700 font-black text-lg border-2 border-yellow-300">' +
                                record.level +
                            '</div>' +
                        '</td>' +
                        '<td class="px-4 py-4 border-b border-purple-100 font-mono text-sm ' + timeClass + '">' +
                            timeStr +
                        '</td>' +
                    '</tr>';
                });
                tbody.innerHTML = html;
            }
            modal.classList.remove('hidden');
        };

        // 启动应用
        initApp();
    </script>
</body>
</html>`;
export {
  worker_default as default
};