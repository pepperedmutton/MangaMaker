import path from "node:path";

export const PROJECT_TITLE = "PsychoPass-GreyNoise";
export const PROJECT_SLUG = "psychopass-grey-noise";
export const PROJECT_FOLDER = "PsychoPass-GreyNoise";
export const PROJECT_TYPE = "manga";

const GLOBAL_STYLE =
  "Full-color anime illustration in a cold cyberpunk police-drama style, clean line art, restrained cel shading, luminous rain reflections, dense futuristic Tokyo architecture, surveillance-heavy atmosphere, self-contained standalone image, single frozen moment, clear cinematic composition.";

const promptOf = ({ shot, scene, cast = [], action, mood, extra = "" }) =>
  [
    GLOBAL_STYLE,
    `${shot} of ${scene}.`,
    ...cast,
    `${action}.`,
    `${mood}.`,
    extra,
    "No speech bubbles, no lettering, no comic border, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");

const round = (text) => ({ text, bubbleType: "round" });
const thought = (text) => ({ text, bubbleType: "thought" });

const panel = ({ position, shotLabel, detail, prompt, dialogues = [] }) => ({
  position,
  shotLabel,
  detail,
  prompt: typeof prompt === "string" ? prompt : promptOf(prompt),
  dialogues,
});

const AKANE_FIELD =
  "Akane Tsunemori, a Japanese woman in her early twenties with a neat brown bob, alert amber-brown eyes, a calm determined expression, and an MWPSB inspector uniform under a pale beige field coat.";
const AKANE_OFFICE =
  "Akane Tsunemori, a Japanese woman in her early twenties with a neat brown bob, alert amber-brown eyes, and the formal blue MWPSB inspector suit with a white shirt and dark tie.";
const KOGAMI_FIELD =
  "Shinya Kogami, a Japanese man in his late twenties with a tall muscular build, rough dark brown hair, light stubble, sharp observant eyes, and a black enforcer suit under an open charcoal overcoat.";
const GINOZA =
  "Nobuchika Ginoza, a Japanese man in his late twenties with a slim build, undercut dark hair, rectangular glasses, a severe expression, and a tailored dark MWPSB inspector suit.";
const AOI =
  "Aoi Kanzaki, a Japanese teenage girl with pale skin, an ash-gray bob haircut, large gray eyes, a thin anxious build, oversized clear monitoring headphones, a white clinic hoodie, a transparent rain shell, black shorts, and dark leggings.";
const AOI_FLASHBACK =
  "Aoi Kanzaki at sixteen, a pale Japanese teenage girl with an ash-gray bob, worried gray eyes, a thin frame, a simple navy school cardigan, and an old pair of silver monitoring headphones held against her chest.";
const AOI_BROTHER =
  "Haru Kanzaki, a fragile Japanese teenage boy with messy black hair, tired soft eyes, a hospital rehabilitation gown, and a trembling posture.";
const ISURUGI =
  "Dr. Ren Isurugi, a Japanese middle-aged man with a tall thin frame, swept-back steel-gray hair, narrow frameless glasses, an unreadable smile, a pristine ivory therapist coat over a black high-neck suit, and black gloves.";
const VICTIM =
  "Tetsuya Maki, an exhausted Japanese office worker in his thirties with an average build, loose black business hair, sunken eyes, a wrinkled white shirt, and a dark suit jacket.";
const PATIENT_GROUP =
  "Several exhausted city patients of different ages wearing sterile clinic loungewear and transparent audio headsets, all sitting with unnaturally calm expressions.";
const DRONES =
  "Multiple armed hovering police drones with cold blue sensors, segmented white armor, and sharp mechanical limbs.";

export const STORY = {
  theme: "真正的平静不能靠系统强行抹平，人必须看见自己的恐惧，才能真正不被它支配。",
  protagonistGoal: "常守朱要查明一宗色相异常清澈却自杀身亡的案件，并阻止一场会让整座城市情绪失真的广播。",
  coreConflict:
    "灰噪疗法让人暂时压平痛苦与恐惧，但其发明者雾岛葵只想保护家人，真正将它武器化的是受到西比拉认可的治疗师石动廉。",
  turningPoint: "朱在天台见到葵，得知今夜广播塔会向全城扩散灰噪，案件从个别死亡升级为制度级危机。",
  climax: "广播塔顶层，狡啮准备直接射杀石动，朱阻止他，同时说服葵把广播改成揭露被压抑痛苦的信号。",
  closure: "石动被捕，葵决定作证，朱确认‘不被系统立刻判定的人’也依然可以主动选择面对自己的阴影。",
  shortOutline: [
    "开场：雨夜新东京出现一宗异常自杀案，死者在极低犯罪系数下跳楼，现场残留神秘音频设备。",
    "中段：公安追查‘灰噪’疗法，发现它由少女声学工程师雾岛葵开发，却被石动廉改造成面向全城的情绪压平广播。",
    "结尾：广播塔决战中，朱阻止了以暴制暴，迫使真相以更痛但更真实的方式暴露，故事以黎明中的不安定希望收束。",
  ],
};

export const CHARACTERS = [
  {
    name: "常守朱 / Akane Tsunemori",
    baseline: [
      "年龄感：二十岁出头的年轻女性。",
      "性别感：温和但坚定的女性气质。",
      "身高和体型：中等身高，纤细匀称，但站姿稳定。",
      "脸型：偏圆的鹅蛋脸。",
      "五官特征：眼神清醒，瞳孔明亮，嘴角收得很稳。",
      "发型和发色：棕色短发，整齐 bob，额前碎发较少。",
      "肤色：自然偏白。",
      "气质关键词：冷静、同理、正直、在高压中仍保持柔软。",
      "默认姿态和表情倾向：站姿端正，肩线不塌，表情克制但不冷漠。",
    ],
    variants: [
      "公安外勤：米白色外勤大衣盖在公安制服外，深色短裙、黑色连裤袜、低调配枪。",
      "办公室：标准公安制服套装，蓝色外套、白衬衫、深色领带，整体干净利落。",
    ],
    rules: [
      "固定道具：Dominator、公安终端。",
      "稳定视觉元素：在强光和雨夜里依然保持眼神清楚，不画成麻木或嗜血。",
      "禁止元素：夸张哥特配饰、重金属风妆容、过度性感化服装。",
    ],
  },
  {
    name: "狡啮慎也 / Shinya Kogami",
    baseline: [
      "年龄感：二十多岁的成熟男性。",
      "性别感：强烈的成年男性压迫感与行动性。",
      "身高和体型：高个、肩背宽、偏运动型。",
      "脸型：轮廓分明，颧骨与下颌线清晰。",
      "五官特征：眼窝略深，目光锐利，轻微胡渣。",
      "发型和发色：深棕偏黑的短乱发。",
      "肤色：健康小麦偏浅。",
      "气质关键词：猎犬般专注、危险、沉着、随时准备扑上去。",
      "默认姿态和表情倾向：前倾、观察、惯于压低重心。",
    ],
    variants: [
      "公安外勤：黑色执行官内搭，外罩敞开的炭灰长外套。",
      "近战状态：衣摆被雨和动作拉开，袖口湿透，姿态更低更像猎人。",
    ],
    rules: [
      "固定道具：Dominator。",
      "稳定视觉元素：任何页面里都保留压迫性的身体前冲感。",
      "禁止元素：过度干净的学生感、松弛的搞笑表情。",
    ],
  },
  {
    name: "宜野座伸元 / Nobuchika Ginoza",
    baseline: [
      "年龄感：二十多岁的精英男性。",
      "性别感：克制、尖锐、官僚化的男性气质。",
      "身高和体型：偏高偏瘦，肩线窄于狡啮。",
      "脸型：长脸，轮廓利落。",
      "五官特征：戴矩形眼镜，眉心容易锁住。",
      "发型和发色：深色背梳或侧分。",
      "肤色：偏白。",
      "气质关键词：紧绷、专业、习惯用规则维持秩序。",
      "默认姿态和表情倾向：站直，双臂常压在身侧或胸前，语气像在下达命令。",
    ],
    variants: ["办公室：深色公安制服西装，极少配饰。"],
    rules: [
      "固定道具：眼镜、指挥终端。",
      "禁止元素：随性的街头穿搭、过于柔和的身体语言。",
    ],
  },
  {
    name: "雾岛葵 / Aoi Kanzaki",
    baseline: [
      "年龄感：十七岁的未成年少女。",
      "性别感：脆弱、警觉、随时准备逃跑。",
      "身高和体型：偏瘦偏小，肩膀略向内收。",
      "脸型：小巧、下巴偏尖。",
      "五官特征：灰色大眼，眼下有淡淡睡眠不足痕迹。",
      "发型和发色：灰白色短 bob，发尾轻微外翘。",
      "肤色：病态偏白。",
      "气质关键词：紧张、敏感、聪明、长期没有被真正保护过。",
      "默认姿态和表情倾向：抱臂、自我保护、说话前会先看逃生路线。",
    ],
    variants: [
      "地下工作状态：白色卫衣、透明雨壳、黑色短裤和深色打底裤，挂着透明监听耳机。",
      "回忆状态：海军蓝开衫、旧式银色耳机、学生气更重。",
    ],
    rules: [
      "固定道具：监听耳机、便携声学终端。",
      "稳定视觉元素：她与声音设备的距离始终很近，常让手指停在旋钮或耳机上。",
      "禁止元素：华丽首饰、鲜艳暖色大面积服装。",
    ],
  },
  {
    name: "石动廉 / Dr. Ren Isurugi",
    baseline: [
      "年龄感：四十岁上下。",
      "性别感：瘦削、控制欲强、看起来礼貌却不温暖。",
      "身高和体型：高瘦，像一把折起来的刀。",
      "脸型：窄长。",
      "五官特征：金属边无框眼镜，笑意只停留在嘴角。",
      "发型和发色：钢灰色后梳。",
      "肤色：偏白、医院灯下更冷。",
      "气质关键词：洁癖、精确、像治疗师也像祭司。",
      "默认姿态和表情倾向：手指并拢，动作经济，目光像在测量他人。",
    ],
    variants: [
      "治疗师形态：象牙白医师长外套，内搭黑色高领套装。",
      "广播塔控制形态：白外套在强风里展开，像一面过分干净的旗。",
    ],
    rules: [
      "固定道具：黑手套、控制终端、环形音频设备。",
      "禁止元素：狼狈邋遢、外露武装感过强。",
    ],
  },
];

export const PAGES = [
  {
    number: 1,
    pageFunction: "封面式开场，建立作品气质与监控都市的压迫感。",
    emotion: "冷、静、危险在远处逼近。",
    turn: "读者进入这个把情绪量化的城市。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "雨夜的新东京高空被蓝白色全息广告切开，透明天桥像手术缝线一样横过楼群，远处巡逻无人机排成冷淡秩序，画面前景只留下站在观景平台边缘的常守朱背影，像一枚要被系统吞下的人类标点。",
        prompt: {
          shot: "A wide cinematic long shot",
          scene: "a rain-soaked observation deck high above futuristic Tokyo at night with layered holograms and police drones crossing deep blue fog",
          cast: [AKANE_FIELD],
          action:
            "Akane Tsunemori stands alone at the edge of the platform and looks down over the city while distant patrol lights form geometric trails beneath her",
          mood: "The mood is clinically cold, immense, and quietly oppressive",
        },
      }),
    ],
  },
  {
    number: 2,
    pageFunction: "把第一名死者与灰噪疗法一起引入故事。",
    emotion: "疲惫、麻木、假性的安定。",
    turn: "死者在坠落前并不慌乱，这就是异常。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "中景",
        detail:
          "深夜办公层只剩冷白灯和大片玻璃，真木哲也靠在落地窗边，西装皱得发软，透明耳机贴着耳廓，桌面却整齐得近乎神经质。对白：“你昨晚又没睡？”",
        prompt: {
          shot: "A medium shot",
          scene: "a nearly empty corporate office floor with cold white lights, reflective glass walls, and a rain-blurred skyline",
          cast: [VICTIM],
          action:
            "Tetsuya Maki leans near the window with transparent audio buds in his ears while his desk behind him remains obsessively neat",
          mood: "The still image feels exhausted, airless, and unnaturally composed",
        },
        dialogues: [round("你昨晚又没睡？")],
      }),
      panel({
        position: "下半页",
        shotLabel: "特写",
        detail:
          "手机旁边的声波界面只剩柔和起伏的无字波纹，真木的手指停在耳机线上，眼睛空得像是已经从自己的痛苦里被抽离出去。对白：“我现在很安静。”",
        prompt: {
          shot: "An intimate close-up",
          scene: "the victim's hand, earbud cable, and a glowing audio waveform interface on a dark office desk",
          cast: [VICTIM],
          action:
            "His fingertips rest on the cable while his hollow gaze reflects the pale waveform light and all tension seems unnaturally flattened",
          mood: "The mood is numb, sterile, and faintly wrong",
        },
        dialogues: [round("我现在很安静。")],
      }),
    ],
  },
  {
    number: 3,
    pageFunction: "用单页冲击展示异常自杀。",
    emotion: "失重、寂静、突兀。",
    turn: "死者在平静中坠落，事件彻底成立。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "动作格",
        detail:
          "冻结在半空的一瞬间，真木从高楼边缘后仰坠下，雨线和全息广告在他身后拉成长条，底部警用无人机正抬头扫描，整个画面诡异地没有尖叫感。",
        prompt: {
          shot: "A dramatic frozen action shot",
          scene: "the open night air beside a skyscraper covered in holographic ads and heavy rain",
          cast: [VICTIM, DRONES],
          action:
            "Tetsuya Maki falls backward from the tower in a strangely relaxed posture while police drones below begin to tilt their sensors upward",
          mood: "The image feels silent, unreal, and fatally calm instead of chaotic",
        },
      }),
    ],
  },
  {
    number: 4,
    pageFunction: "公安到场，抛出犯罪系数与现场观感不匹配的核心谜团。",
    emotion: "专业、疑惑、细针般的不安。",
    turn: "常守与狡啮同时意识到这不是普通自杀。",
    topology: "topWideBottomTwo",
    topologyLabel: "上宽下双格",
    panels: [
      panel({
        position: "上横贯",
        shotLabel: "中景",
        detail:
          "雨后的事故平台被蓝色封锁线和便携照明切成整洁几何，常守朱半蹲在尸体轮廓边，狡啮慎也站在她身后偏暗处，现场像一台过于安静的手术台。对白：“色相呢？”",
        prompt: {
          shot: "A medium-wide investigative shot",
          scene: "a wet elevated accident platform lit by portable forensic lamps and blue police barriers",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane crouches beside the outlined body while Kogami stands behind her in shadow and both study the scene with immediate distrust",
          mood: "The atmosphere is procedural, clean, and threaded with unease",
        },
        dialogues: [round("色相呢？")],
      }),
      panel({
        position: "左下",
        shotLabel: "近景",
        detail:
          "便携扫描仪投出的全息判定环是过分柔和的淡色，像这具尸体直到死前都没有真正被系统视为危险。对白：“低得过头，像被人替他把噪音擦掉了。”",
        prompt: {
          shot: "A close investigative shot",
          scene: "a forensic hologram floating above wet concrete beside a covered body",
          action:
            "A pale crime-analysis ring glows with an impossibly soft hue beside the corpse and the result looks clean when it should not",
          mood: "The image is precise, eerie, and intellectually disturbing",
        },
        dialogues: [round("低得过头，像被人替他把噪音擦掉了。")],
      }),
      panel({
        position: "右下",
        shotLabel: "特写",
        detail:
          "狡啮微微低头，雨水从发梢和胡渣上滴下去，眼神像猎犬在闻到被故意擦掉的血味。对白：“不是自杀冲动被消掉了，是人被掏空了。”",
        prompt: {
          shot: "A tight character close-up",
          scene: "the rainy edge of the crime scene with police lights blurred into blue streaks behind a dark figure",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami lowers his face slightly and watches the impossible scan result with the expression of a hunter who has found a hidden track",
          mood: "The mood is sharp, predatory, and quietly furious",
        },
        dialogues: [round("不是自杀冲动被消掉了，是人被掏空了。")],
      }),
    ],
  },
  {
    number: 5,
    pageFunction: "让朱和狡啮在案件判断上第一次碰撞。",
    emotion: "推理中的拉扯。",
    turn: "两人的视角不同，但都认定案件背后有技术操控。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "中景",
        detail:
          "回收走廊狭长发亮，常守与狡啮并肩向前，封存袋里那副透明耳机在两人之间微微晃动。对白：“如果是新型镇静程序，它为什么会把人推到窗边？”",
        prompt: {
          shot: "A medium walking shot",
          scene: "a narrow evidence corridor with glossy walls, white ceiling strips, and police staff moving in the background",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane and Kogami walk side by side while a bagged transparent headset swings between them as the central clue",
          mood: "The tone is analytical, brisk, and edged with disagreement",
        },
        dialogues: [round("如果是新型镇静程序，它为什么会把人推到窗边？")],
      }),
      panel({
        position: "右半页",
        shotLabel: "近景",
        detail:
          "常守偏头看向狡啮，目光没有退缩，狡啮则盯着前方，像已经在脑中把看不见的猎物按进墙里。对白：“因为它让人暂时不再害怕死。”",
        prompt: {
          shot: "A close two-character shot",
          scene: "the same sterile corridor seen tighter with reflected light sliding across polished walls",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane turns toward Kogami with focused calm while he keeps staring ahead as if already chasing the unseen source",
          mood: "The image is tense, intelligent, and morally unsettled",
        },
        dialogues: [round("因为它让人暂时不再害怕死。")],
      }),
    ],
  },
  {
    number: 6,
    pageFunction: "由宜野座把案件扩大为系统性异常。",
    emotion: "秩序感、压迫感。",
    turn: "类似死者并非孤例。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "公安局指挥室像蓝色水槽一样铺满光屏，宜野座站在中心，身后墙面排列出数名低犯罪系数死者的影像和相似的声波曲线，常守与狡啮分立画面两侧。对白：“七天内第五例，全部在听同一种私制音频。”",
        prompt: {
          shot: "A wide command-room shot",
          scene: "the MWPSB operations center filled with layered blue holographic screens and case files floating in dark space",
          cast: [GINOZA, AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Ginoza briefs the room from the center while multiple victim images and matching audio-wave patterns hover behind him as a coordinated anomaly",
          mood: "The atmosphere is controlled, official, and increasingly ominous",
        },
        dialogues: [round("七天内第五例，全部在听同一种私制音频。")],
      }),
    ],
  },
  {
    number: 7,
    pageFunction: "回到死者生活空间，寻找音频来源。",
    emotion: "静物里的病态秩序。",
    turn: "灰噪并非普通消费品，而是被定制投喂。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "远景",
        detail:
          "真木的公寓小而极整洁，药盒、营养剂、折好的衬衫像被尺量过一样排成线，房间中央却摆着一组被非法改装的音响和耳机底座。对白：“他在把自己当机器维护。”",
        prompt: {
          shot: "A wide interior shot",
          scene: "a tiny apartment with obsessive order, folded office clothes, medicine packs, and an illegally modified audio dock at the center",
          cast: [AKANE_FIELD],
          action:
            "Akane stands inside the immaculate room and studies the modified audio setup that feels more intimate than the rest of the apartment",
          mood: "The room feels lonely, controlled, and quietly unhealthy",
        },
        dialogues: [round("他在把自己当机器维护。")],
      }),
      panel({
        position: "下半页",
        shotLabel: "近景",
        detail:
          "狡啮把底座翻过来，看到隐藏在壳体里的私接发射模块，冷色指示灯像小型心跳。对白：“不是下载，是有人持续给他喂。”",
        prompt: {
          shot: "A close evidence shot",
          scene: "the underside of a hacked audio dock lit by tiny cold indicator lights on a dark floor",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami lifts the device and reveals a concealed transmitter module wired into the shell with rough but deliberate craftsmanship",
          mood: "The image is tactile, clandestine, and accusatory",
        },
        dialogues: [round("不是下载，是有人持续给他喂。")],
      }),
    ],
  },
  {
    number: 8,
    pageFunction: "首次正式出场葵。",
    emotion: "脆弱与才华同时成立。",
    turn: "灰噪背后确实有一个具体的人。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "地下录音间被旧吸音棉和自制线路塞满，雾岛葵坐在旋钮和波形屏之间，透明耳机压住她的灰白短发，脸上是一种长期失眠后的精密警觉。对白：“再撑一天……只要再撑一天。”",
        prompt: {
          shot: "A medium full-page character reveal",
          scene: "an underground sound studio packed with old acoustic foam, dangling cables, analog knobs, and dim waveform monitors",
          cast: [AOI],
          action:
            "Aoi Kanzaki sits at the cramped mixing desk with both hands near the controls and listens to a private signal as if her life depends on every frequency",
          mood: "The image feels fragile, intelligent, and cornered",
        },
        dialogues: [thought("再撑一天……只要再撑一天。")],
      }),
    ],
  },
  {
    number: 9,
    pageFunction: "狡啮沿黑市渠道追到灰噪的物理流通线。",
    emotion: "猎捕开始。",
    turn: "公安离发明者更近一步。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "远景",
        detail:
          "夜市巷道堆满廉价霓虹、蒸汽和走私终端，狡啮逆着人流前行，目光锁死一家摆着透明监听耳机的小摊。对白：“卖给真木的人是谁？”",
        prompt: {
          shot: "A wide urban chase setup shot",
          scene: "a crowded neon street market with steam, cheap electronics, hanging signs, and rain-slick pavement",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami pushes against the crowd and fixes his attention on a stall displaying the same transparent monitoring headsets from the case",
          mood: "The image is aggressive, humid, and full of pursuit energy",
        },
        dialogues: [round("卖给真木的人是谁？")],
      }),
      panel({
        position: "右半页",
        shotLabel: "动作格",
        detail:
          "摊主惊慌后退，背景一角掠过披着透明雨壳的少女侧影，她回头的瞬间露出灰白短发和熟悉耳机，然后立刻消失进巷口。对白：“喂，等一下！”",
        prompt: {
          shot: "A sharp action still",
          scene: "the same crowded market seen tighter with stalls, hanging cables, and a dark alley mouth beyond the crowd",
          cast: [KOGAMI_FIELD, AOI],
          action:
            "The frightened vendor recoils while Aoi flashes across the frame in a transparent rain shell, glancing back for a split second before slipping into the alley",
          mood: "The panel feels sudden, elusive, and full of kinetic tension",
        },
        dialogues: [round("喂，等一下！")],
      }),
    ],
  },
  {
    number: 10,
    pageFunction: "把追逐的对象从‘嫌疑人’变成‘人’。",
    emotion: "慌张、防御。",
    turn: "葵并不像操盘者，更像被逼到墙角的孩子。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "狭窄后巷尽头堆满雨水和废旧广告屏，葵半转身站住，像一只被灯照住的野猫，一只手护着终端，一只手还按着耳机。对白：“别过来，我没有想杀人。”",
        prompt: {
          shot: "A medium confrontation shot",
          scene: "a cramped service alley full of puddles, dead hologram panels, and harsh reflected neon",
          cast: [AOI],
          action:
            "Aoi stops at the dead end, half turned toward the pursuer, protecting her portable terminal with one hand while the other grips her headphones",
          mood: "The image feels frightened, defensive, and painfully young",
        },
        dialogues: [round("别过来，我没有想杀人。")],
      }),
    ],
  },
  {
    number: 11,
    pageFunction: "用一个动作证明葵的本性并改变朱的判断。",
    emotion: "紧张里的柔软。",
    turn: "朱意识到葵还在主动照顾别人。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "中景",
        detail:
          "横穿巷口的小孩摔倒，药盒撒了一地，原本准备逃跑的葵还是先蹲下去帮他把药捡起，雨水把她的袖口全浸透。对白：“先拿好，别踩到。”",
        prompt: {
          shot: "A medium compassionate moment",
          scene: "the mouth of the alley opening onto a rainy service road with scattered medicine capsules on wet ground",
          cast: [AOI],
          action:
            "Aoi kneels in the rain to gather a child's spilled medicine instead of using the chance to run, her sleeves soaking through as she helps",
          mood: "The still image is tender, immediate, and morally revealing",
        },
        dialogues: [round("先拿好，别踩到。")],
      }),
      panel({
        position: "下半页",
        shotLabel: "近景",
        detail:
          "常守从巷外的警戒线边停住脚步，Dominator 仍在手里却没有抬起，她看着这一幕，神情第一次从追捕变成判断。对白：“狡啮，她不是现场那种脸。”",
        prompt: {
          shot: "A close reaction shot",
          scene: "the rain-dark edge of the alley with police lights diffused through mist behind an inspector",
          cast: [AKANE_FIELD],
          action:
            "Akane lowers her intent without lowering the Dominator and watches Aoi help the child, reassessing the entire chase in one silent beat",
          mood: "The mood is observant, humane, and quietly decisive",
        },
        dialogues: [round("狡啮，她不是现场那种脸。")],
      }),
    ],
  },
  {
    number: 12,
    pageFunction: "把案件升级成网络化设施问题。",
    emotion: "推理推进、威胁扩张。",
    turn: "灰噪并非单点散发，而是被有计划地布节点。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "高架桥下的废弃基础设施层里，侦查无人机投出城市热图，多个隐蔽中继节点像病灶一样浮在新东京地图上，常守与狡啮站在蓝光里看向同一座广播塔。对白：“有人在为整座区做压力测试。”",
        prompt: {
          shot: "A wide analytical shot",
          scene: "an abandoned infrastructure deck under elevated rails with mapping drones projecting a luminous city network into the damp air",
          cast: [AKANE_FIELD, KOGAMI_FIELD, DRONES],
          action:
            "Akane and Kogami stand inside the holographic map and trace multiple illegal relay nodes that converge toward a distant broadcast tower",
          mood: "The image feels strategic, ominous, and larger than the first death",
        },
        dialogues: [round("有人在为整座区做压力测试。")],
      }),
    ],
  },
  {
    number: 13,
    pageFunction: "石动廉以‘被认可的秩序’身份登场。",
    emotion: "洁净外表下的恶意。",
    turn: "嫌疑对象第一次明确。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "竖大格",
        detail:
          "巨大楼体外墙上的公益治疗广告正无声播放，石动廉的微笑脸庞悬在夜色里，下方行人像被一尊洁白神像俯瞰，广告边缘浮着柔和音波形状。对白：“把情绪留给专业系统，你只需要安静。”",
        prompt: {
          shot: "A towering vertical shot",
          scene: "the exterior wall of a medical high-rise carrying an enormous therapeutic hologram advertisement above the night street",
          cast: [ISURUGI],
          action:
            "Dr. Ren Isurugi's controlled smiling face dominates the building-sized display while tiny pedestrians move below under the soft halo of audio graphics",
          mood: "The image is immaculate, seductive, and deeply authoritarian",
        },
        dialogues: [round("把情绪留给专业系统，你只需要安静。")],
      }),
    ],
  },
  {
    number: 14,
    pageFunction: "进入合法外壳下的灰噪临床场域。",
    emotion: "平静到近乎恐怖。",
    turn: "合法治疗机构与非法灰噪网络重叠。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "远景",
        detail:
          "石动诊所大厅雪白得像被消毒过度，水景墙和缓慢移动的机械花组成毫无瑕疵的安抚空间，常守与狡啮站在入口，像两块不属于这里的深色影子。",
        prompt: {
          shot: "A wide location shot",
          scene: "an unnaturally pristine therapy clinic lobby with white walls, a minimal water feature, and slow kinetic mechanical flowers",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane and Kogami enter the immaculate lobby and immediately read as foreign dark figures inside the curated calm",
          mood: "The scene feels polished, expensive, and eerily dehumanized",
        },
      }),
      panel({
        position: "下半页",
        shotLabel: "中景",
        detail:
          "等候区的病人们整齐坐着，透明头戴设备把每个人都变成同一种安静姿势，像一排被柔光覆盖的标本。对白：“这里的安静太整齐了。”",
        prompt: {
          shot: "A medium tableau shot",
          scene: "the clinic waiting area with rows of identical chairs and pale ambient light",
          cast: [PATIENT_GROUP],
          action:
            "The patients sit with synchronized calm expressions under transparent audio headsets, each body arranged with almost identical stillness",
          mood: "The stillness is beautiful at first glance and horrifying on second glance",
        },
        dialogues: [round("这里的安静太整齐了。")],
      }),
    ],
  },
  {
    number: 15,
    pageFunction: "证明灰噪已经被嵌进治疗流程。",
    emotion: "表面温柔、内部操控。",
    turn: "朱与狡啮分别从人和装置两边确认异常。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "中景",
        detail:
          "常守坐在病人对面，病人眼下浮肿却笑得过分放松，手里的一次性纸杯稳得没有一丝抖动。对白：“戴上以后，坏念头像被棉花包住了。”",
        prompt: {
          shot: "A medium interview shot",
          scene: "a small clinic consultation corner with white partitions and soft indirect lighting",
          cast: [AKANE_FIELD, PATIENT_GROUP],
          action:
            "Akane questions one exhausted patient whose smile is too loose and too smooth while a paper cup stays unnaturally steady in trembling hands",
          mood: "The image is compassionate on the surface and manipulated underneath",
        },
        dialogues: [round("戴上以后，坏念头像被棉花包住了。")],
      }),
      panel({
        position: "右半页",
        shotLabel: "近景",
        detail:
          "另一侧，狡啮从治疗椅后方掀开装饰壳板，露出与真木家底座完全同款的私接端口。对白：“不是辅助治疗，是直连投喂。”",
        prompt: {
          shot: "A close equipment reveal",
          scene: "the rear side of a sleek therapy chair inside the clinic",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami peels back a decorative shell and exposes an illegal hardwired port identical to the transmitter hardware from the victim's apartment",
          mood: "The reveal is tactile, damning, and surgically precise",
        },
        dialogues: [round("不是辅助治疗，是直连投喂。")],
      }),
    ],
  },
  {
    number: 16,
    pageFunction: "朱与石动第一次正面对话。",
    emotion: "礼貌下的针锋相对。",
    turn: "石动把自己的立场说得近乎宗教。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "极简治疗室里只有白桌、浅色椅与一面看不见外界的玻璃，石动廉坐姿优雅得像在主持祷告，常守站着没有落座。对白：“人不需要学习痛苦，只需要被正确管理。”",
        prompt: {
          shot: "A composed confrontation shot",
          scene: "an ultra-minimal therapy room with white furniture, hidden lighting, and sealed glass walls",
          cast: [AKANE_FIELD, ISURUGI],
          action:
            "Isurugi sits with priest-like precision at the table while Akane remains standing, refusing the calm geometry he has prepared for her",
          mood: "The mood is polite, sharp, and ideologically hostile",
        },
        dialogues: [round("人不需要学习痛苦，只需要被正确管理。")],
      }),
    ],
  },
  {
    number: 17,
    pageFunction: "狡啮找到石动物理层面的犯罪证据。",
    emotion: "逼近核心。",
    turn: "灰噪网络与广播设施直接相连。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "动作格",
        detail:
          "狡啮在诊所维护层撬开地板检修盖，下面整齐排列着未经登记的中继设备，蓝色状态灯密密一片，像藏在地板下的虫群。对白：“找到巢了。”",
        prompt: {
          shot: "A low-angle action still",
          scene: "a narrow clinic maintenance corridor with floor panels pried open and condensation on metal walls",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami pulls up the service hatch and reveals an ordered cluster of illegal relay units glowing under the floor like a hidden nest",
          mood: "The image is gritty, predatory, and triumphant in a dangerous way",
        },
        dialogues: [round("找到巢了。")],
      }),
      panel({
        position: "下半页",
        shotLabel: "近景",
        detail:
          "中继设备之间的信号束在增强现实里连向城市边缘的旧广播塔，线路像冰冷血管。对白：“终端在城北旧塔，今晚会开全功率。”",
        prompt: {
          shot: "A close technical shot",
          scene: "the exposed relay hardware seen through an augmented-reality overlay of signal trajectories",
          action:
            "Cold beams of mapped transmission extend from the illegal units toward an old broadcast tower on the northern edge of the city",
          mood: "The panel feels precise, inevitable, and strategically alarming",
        },
        dialogues: [round("终端在城北旧塔，今晚会开全功率。")],
      }),
    ],
  },
  {
    number: 18,
    pageFunction: "让制度压力压到朱身上。",
    emotion: "命令、限制、逼迫。",
    turn: "朱必须在守规与救人之间抢时间。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "指挥室里，宜野座站在大片监控蓝光前，语气冷硬，常守被投影的程序条款切割在画面前景。对白：“没有完整授权，任何接触广播塔的行动都算越权。”",
        prompt: {
          shot: "A medium command confrontation shot",
          scene: "the MWPSB command center washed in blue legal interface light and surveillance feeds",
          cast: [GINOZA, AKANE_OFFICE],
          action:
            "Ginoza delivers a hard warning while policy overlays cut across Akane in the foreground like visible restraints",
          mood: "The image is strict, bureaucratic, and pressurized",
        },
        dialogues: [round("没有完整授权，任何接触广播塔的行动都算越权。")],
      }),
    ],
  },
  {
    number: 19,
    pageFunction: "葵主动接触朱。",
    emotion: "信任试探。",
    turn: "葵决定把真相交给朱，而不是继续逃。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "近景",
        detail:
          "常守的手持终端在黑暗办公室里亮起匿名连接提示，只有一枚简化的声波图标在雨夜反光里闪动。对白：“如果你真的想救人，一个人来。”",
        prompt: {
          shot: "A close device shot",
          scene: "a dark office desk with rain reflections and a handheld police terminal lighting the scene",
          cast: [AKANE_OFFICE],
          action:
            "Akane reads an anonymous incoming signal marked only by a minimal waveform icon while the office around her stays almost black",
          mood: "The mood is secretive, urgent, and precariously hopeful",
        },
        dialogues: [round("如果你真的想救人，一个人来。")],
      }),
      panel({
        position: "右半页",
        shotLabel: "远景",
        detail:
          "雨中的天台通道空而高，常守独自走向尽头，远处站着一团被风吹得极薄的白色身影。",
        prompt: {
          shot: "A wide rooftop approach shot",
          scene: "a high rooftop catwalk in rain with red aircraft lights and deep city darkness beyond",
          cast: [AKANE_FIELD, AOI],
          action:
            "Akane walks alone along the slick catwalk toward Aoi's thin white silhouette waiting at the far end in the storm",
          mood: "The scene is lonely, suspended, and charged with fragile trust",
        },
      }),
    ],
  },
  {
    number: 20,
    pageFunction: "朱与葵在制度之外正式对话。",
    emotion: "脆弱的坦白。",
    turn: "葵承认灰噪是自己做的，但动机不是杀人。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "暴雨天台上没有遮蔽物，葵抱着便携终端站在边缘，常守停在离她几步的地方，不把武器举起。对白：“灰噪是我做的，可我一开始只是想让他别那么害怕。”",
        prompt: {
          shot: "A full-page emotional confrontation shot",
          scene: "an exposed rooftop under hard rain and aircraft warning lights with the city dissolving into mist below",
          cast: [AKANE_FIELD, AOI],
          action:
            "Aoi clutches her portable terminal near the ledge while Akane stops a few steps away and keeps her weapon lowered to preserve the conversation",
          mood: "The mood is intimate, storm-beaten, and painfully sincere",
        },
        dialogues: [round("灰噪是我做的，可我一开始只是想让他别那么害怕。")],
      }),
    ],
  },
  {
    number: 21,
    pageFunction: "给葵的动机和情感根源。",
    emotion: "柔软、伤口、回忆。",
    turn: "灰噪诞生于她保护哥哥的失败经验。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "幻想中景",
        detail:
          "回忆里的康复走廊安静而淡色，年少的葵扶着哥哥向前走，哥哥的手臂在发抖，走廊尽头的扫描门闪着不近人情的红光，她怀里的旧银色耳机是唯一有温度的东西。对白：“哥只要一害怕，数值就会立刻往上跳。”",
        prompt: {
          shot: "A soft medium flashback shot",
          scene: "a rehabilitation corridor with pale walls, distant red scanner lights, and muted institutional daylight",
          cast: [AOI_FLASHBACK, AOI_BROTHER],
          action:
            "Young Aoi supports her trembling brother as they move toward the scanner gate while she holds an old pair of silver headphones close to her chest",
          mood: "The image is tender, helpless, and shaped by remembered fear",
        },
        dialogues: [round("哥只要一害怕，数值就会立刻往上跳。")],
      }),
    ],
  },
  {
    number: 22,
    pageFunction: "把真相说完整，明确石动的计划。",
    emotion: "坦白后的加速。",
    turn: "今晚广播塔会向全区扩散灰噪。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "中景",
        detail:
          "葵把便携投影展开在雨幕里，塔体线路、诊所节点和家庭端口像骨架一样一层层叠出来，她的指尖停在最上层主发射环。对白：“石动把它改成了全城版本，他想让每个人都学会‘正确地平静’。”",
        prompt: {
          shot: "A medium technical confession shot",
          scene: "the stormy rooftop with a portable holographic projection of tower circuits floating between two figures",
          cast: [AOI, AKANE_FIELD],
          action:
            "Aoi projects the full network architecture into the rain and points at the master ring transmitter while Akane studies the diagram without interrupting",
          mood: "The image is urgent, revelatory, and laced with guilt",
        },
        dialogues: [round("石动把它改成了全城版本，他想让每个人都学会‘正确地平静’。")],
      }),
      panel({
        position: "下半页",
        shotLabel: "近景",
        detail:
          "常守看向旧广播塔在远处的轮廓，风把她的外套和领带都拉向同一个方向，整个人像刚做完决定。对白：“那今晚我们先把他的话筒夺下来。”",
        prompt: {
          shot: "A close resolve shot",
          scene: "Akane on the rooftop with the old broadcast tower visible far away through rain and warning lights",
          cast: [AKANE_FIELD],
          action:
            "Akane turns toward the distant tower and lets the wind pull her coat sharply backward as her decision settles into place",
          mood: "The mood is firm, lucid, and forward-driving",
        },
        dialogues: [round("那今晚我们先把他的话筒夺下来。")],
      }),
    ],
  },
  {
    number: 23,
    pageFunction: "决战场景建立。",
    emotion: "风暴前的吸气。",
    turn: "广播塔成为明确终点。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "城北旧广播塔立在工业区与居民区交界处，塔身老旧，新的黑色中继环却像寄生物一样一圈圈缠在上面，夜色被红色航标灯切成断续脉搏。",
        prompt: {
          shot: "A wide establishing shot",
          scene: "an old broadcast tower at the border of industrial blocks and residential towers under a storm-dark sky",
          action:
            "New black relay rings coil around the aging tower structure like parasites while red aviation lights pulse through the rain",
          mood: "The image feels monumental, diseased, and inevitable",
        },
      }),
    ],
  },
  {
    number: 24,
    pageFunction: "行动前准备。",
    emotion: "压住情绪的实战冷静。",
    turn: "朱与狡啮站到同一战线上，但方式仍不同。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "近景",
        detail:
          "装备间的冷光里，常守检查 Dominator 与通讯器，动作快而不乱，外套下摆还带着屋顶留下的雨痕。对白：“我要石动活着，也要葵活着。”",
        prompt: {
          shot: "A close preparation shot",
          scene: "a police equipment room lit by cool overhead strips and metal lockers",
          cast: [AKANE_FIELD],
          action:
            "Akane inspects her Dominator and comms unit with controlled speed while rain still darkens the hem of her coat",
          mood: "The still image is disciplined, determined, and morally exact",
        },
        dialogues: [round("我要石动活着，也要葵活着。")],
      }),
      panel({
        position: "右半页",
        shotLabel: "近景",
        detail:
          "另一侧，狡啮拉紧手套，眼神低下去，像在给自己套回猎人的皮。对白：“那你最好比他快，也比我快。”",
        prompt: {
          shot: "A close predatory prep shot",
          scene: "the same equipment room rendered darker around a single figure dressing for field action",
          cast: [KOGAMI_FIELD],
          action:
            "Kogami tightens one glove and lowers his gaze with the focus of someone already rehearsing violence in advance",
          mood: "The image is dangerous, contained, and loaded with momentum",
        },
        dialogues: [round("那你最好比他快，也比我快。")],
      }),
    ],
  },
  {
    number: 25,
    pageFunction: "行动正式开始。",
    emotion: "风暴、潜入、被时间追赶。",
    turn: "公安与广播塔第一次接触。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "暴雨里，常守、狡啮与数架侦查无人机从工业区阴影间逼近广播塔底部，积水把红色警示灯拖成长长的裂口。",
        prompt: {
          shot: "A wide infiltration shot",
          scene: "the flooded industrial perimeter around the old broadcast tower in hard rain and red warning light",
          cast: [AKANE_FIELD, KOGAMI_FIELD, DRONES],
          action:
            "Akane and Kogami advance through the shadows at the tower base while scouting drones fan out overhead across the storm",
          mood: "The atmosphere is urgent, metallic, and heavy with approaching conflict",
        },
      }),
    ],
  },
  {
    number: 26,
    pageFunction: "从空间层面增加潜入压迫感。",
    emotion: "狭窄、湿冷、越来越近。",
    turn: "他们已进入石动的系统内部。",
    topology: "leftTallRightTwo",
    topologyLabel: "左竖右双格",
    panels: [
      panel({
        position: "左竖格",
        shotLabel: "竖大格",
        detail:
          "积水楼梯井一路向上，常守与狡啮贴着锈蚀扶手快步攀爬，头顶不断传来低频震动，像整座塔在睡梦里磨牙。",
        prompt: {
          shot: "A tall vertical shot",
          scene: "a flooded industrial stairwell inside the broadcast tower with rusted rails and dim emergency lights",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane and Kogami climb the wet stairwell quickly with one hand on the rusted rail as vibration shudders through the entire structure",
          mood: "The frame is claustrophobic, physical, and steadily tightening",
        },
      }),
      panel({
        position: "右上",
        shotLabel: "特写",
        detail:
          "墙角的感应器突然亮起冷蓝瞳孔，水珠挂在镜头外壳边缘。",
        prompt: {
          shot: "An extreme close-up",
          scene: "a tower wall sensor waking up above damp concrete and dripping water",
          action:
            "The compact surveillance sensor opens a cold blue iris and locks onto movement in the stairwell",
          mood: "The image is mechanical, watchful, and intrusive",
        },
      }),
      panel({
        position: "右下",
        shotLabel: "近景",
        detail:
          "靴底踩进台阶积水，红色警示光在水面碎成一片片。对白：“被发现了。”",
        prompt: {
          shot: "A close atmospheric detail shot",
          scene: "a stair tread covered in shallow water and broken alarm reflections",
          action:
            "A boot lands in the puddle and shatters the red warning light into fragments across the water surface",
          mood: "The panel is immediate, tactile, and full of alarm",
        },
        dialogues: [round("被发现了。")],
      }),
    ],
  },
  {
    number: 27,
    pageFunction: "第一次正面战斗。",
    emotion: "骤然爆发。",
    turn: "潜入转入硬碰硬。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "动作格",
        detail:
          "黑暗竖井一下被启动的无人机群照亮，白色装甲和蓝色传感器像一阵机械昆虫风暴从四面八方扑下来，把楼梯井切成危险几何。",
        prompt: {
          shot: "A full-page action storm shot",
          scene: "the interior broadcast shaft exploding into light as combat drones activate in every direction",
          cast: [DRONES],
          action:
            "A swarm of police-grade drones floods the vertical shaft at once and turns the narrow tower interior into a spinning field of blades and sensor beams",
          mood: "The image is violent, technical, and overwhelming",
        },
      }),
    ],
  },
  {
    number: 28,
    pageFunction: "让狡啮接战，朱继续推进。",
    emotion: "分工明确的危机。",
    turn: "狡啮留下断后，朱得以前进。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "动作格",
        detail:
          "狡啮在楼梯平台上转身射击，Dominator 的强光照出他肩背绷紧的轮廓，一架无人机在近距离爆出火星。对白：“朱，往上！”",
        prompt: {
          shot: "A violent medium action shot",
          scene: "the tower landing amid flashing drone lights, sparks, and rain blowing in through broken panels",
          cast: [KOGAMI_FIELD, DRONES],
          action:
            "Kogami pivots on the landing and fires into a charging drone at close range while bracing the entire platform with his body",
          mood: "The panel feels explosive, physical, and fiercely protective",
        },
        dialogues: [round("朱，往上！")],
      }),
      panel({
        position: "右半页",
        shotLabel: "中景",
        detail:
          "常守借着狡啮撕开的空隙冲过侧门，风把她外套整个掀开，前方是通往控制层的狭窄检修通道。",
        prompt: {
          shot: "A fast medium transition shot",
          scene: "a narrow service passage branching upward from the combat-lit landing inside the tower",
          cast: [AKANE_FIELD],
          action:
            "Akane dashes through the opening Kogami created and disappears into the maintenance corridor leading toward the control level",
          mood: "The image is urgent, disciplined, and accelerating",
        },
      }),
    ],
  },
  {
    number: 29,
    pageFunction: "朱直接抵达葵所在的控制层。",
    emotion: "孤立、决定前的寂静。",
    turn: "石动还没出现，但葵已经在按钮前。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "塔顶控制室四周是巨大的玻璃和环形扬声器，城市灯海像深海压在窗外，葵一个人站在主控台前，终端投影把她映得更瘦。对白：“你还是来了。”",
        prompt: {
          shot: "A medium chamber reveal shot",
          scene: "the tower control room with giant windows, ring-shaped speaker arrays, and the city glowing far below like an ocean of lights",
          cast: [AOI],
          action:
            "Aoi stands alone at the master console while the projection light sharpens how small and isolated she looks against the scale of the room",
          mood: "The panel is lonely, suspended, and heavy with consequence",
        },
        dialogues: [round("你还是来了。")],
      }),
    ],
  },
  {
    number: 30,
    pageFunction: "朱说服葵先不要按下去。",
    emotion: "拉住坠落前一秒。",
    turn: "葵在朱面前第一次真正动摇。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "特写",
        detail:
          "葵的手悬在启动滑钮上方，指尖发抖，控制台冷白灯把她的眼圈照得很深。对白：“如果我停下来，那些被压住的人会立刻坏掉。”",
        prompt: {
          shot: "An extreme close-up",
          scene: "Aoi's trembling hand above a sterile illuminated control slider on the tower console",
          cast: [AOI],
          action:
            "Her fingers hover above the activation control and shake visibly in the white machine light as she struggles with the decision",
          mood: "The image is fragile, immediate, and emotionally raw",
        },
        dialogues: [round("如果我停下来，那些被压住的人会立刻坏掉。")],
      }),
      panel({
        position: "下半页",
        shotLabel: "中景",
        detail:
          "常守没有扑过去，只是慢慢把手伸出来，掌心朝上，像在把一个人从边缘请回来。对白：“压住不等于活下来。”",
        prompt: {
          shot: "A medium de-escalation shot",
          scene: "the tower control room seen tighter with speaker rings looming behind two figures",
          cast: [AKANE_FIELD, AOI],
          action:
            "Akane stops at a measured distance and offers one open hand toward Aoi instead of rushing the console",
          mood: "The mood is humane, tense, and built on deliberate restraint",
        },
        dialogues: [round("压住不等于活下来。")],
      }),
    ],
  },
  {
    number: 31,
    pageFunction: "石动进入最终舞台。",
    emotion: "仪式感、控制欲。",
    turn: "真正的反派正式接管现场。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "竖大格",
        detail:
          "控制室后方的门无声打开，石动廉从一圈环形扬声器下走出，白色外套被高处风压掀开，像站上祭坛的主持人。对白：“你们把病误当成了人格。”",
        prompt: {
          shot: "A towering villain entrance shot",
          scene: "the high control chamber with giant concentric speaker rings and a door opening behind the main console",
          cast: [ISURUGI],
          action:
            "Isurugi steps forward under the ring speakers as if entering a ritual stage, his white coat lifting in the tower wind",
          mood: "The image is theatrical, authoritarian, and chillingly composed",
        },
        dialogues: [round("你们把病误当成了人格。")],
      }),
    ],
  },
  {
    number: 32,
    pageFunction: "展示广播一旦启动会带来的城市级影响。",
    emotion: "宏大、诡异、集体失真。",
    turn: "威胁从控制室扩展到全城。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "广播启动的一瞬，夜间十字路口、候车层与高架步道上的人群同时微微停顿，巨大的白色波纹在玻璃与雨幕上掠过，整座城市像被谁按住了呼吸。",
        prompt: {
          shot: "A wide citywide consequence shot",
          scene: "multiple layers of futuristic Tokyo crossings, transit decks, and glass corridors under rain at night",
          action:
            "A silent white pressure wave rolls through the city and makes crowds pause in the same unnatural breathless rhythm at once",
          mood: "The image is vast, uncanny, and socially terrifying",
        },
      }),
    ],
  },
  {
    number: 33,
    pageFunction: "让广播的代价落到朱自己身上。",
    emotion: "理性被推到极限。",
    turn: "朱如果再拖，自己也会被系统拉进判定风险。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "近景",
        detail:
          "公安链路回传的风险监控在空中疯狂叠层，控制室里红蓝警示同时跳动，系统开始把现场所有人的波动当成不稳定源。对白：“现场执法系数持续上升！”",
        prompt: {
          shot: "A close systems-overload shot",
          scene: "the control room filled with overlapping enforcement HUD warnings and alarm light",
          action:
            "Risk overlays stack chaotically in the air as the system begins to treat everyone inside the tower as a rising instability source",
          mood: "The panel is technical, frantic, and near a threshold collapse",
        },
        dialogues: [round("现场执法系数持续上升！")],
      }),
      panel({
        position: "右半页",
        shotLabel: "特写",
        detail:
          "常守额角渗出冷汗，却仍死死盯着葵和石动之间的距离，她在被广播撕扯，也在逼自己保持清醒。对白：“再给我十秒。”",
        prompt: {
          shot: "An intense close-up",
          scene: "Akane's face in flashing white and red control-room light",
          cast: [AKANE_FIELD],
          action:
            "Akane holds her focus through the mental pressure, sweat at her temple, eyes locked on the space between Aoi and Isurugi instead of the alarms around her",
          mood: "The image is strained, resolute, and emotionally expensive",
        },
        dialogues: [round("再给我十秒。")],
      }),
    ],
  },
  {
    number: 34,
    pageFunction: "朱挡在狡啮与石动之间。",
    emotion: "信念硬碰硬。",
    turn: "故事的伦理中心到达最尖锐处。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "动作格",
        detail:
          "狡啮从侧门冲入，Dominator 已经抬起，枪口对准石动胸口；常守横跨一步拦在中间，用前臂直接压住枪身，三个人被警报红光切成三角构图。对白：“别把答案也打碎！”",
        prompt: {
          shot: "A full-page ethical clash shot",
          scene: "the control chamber under flashing alarm red with the city lights beyond the windows",
          cast: [AKANE_FIELD, KOGAMI_FIELD, ISURUGI],
          action:
            "Kogami storms in with his Dominator aimed at Isurugi but Akane steps directly into the line and forces the weapon aside with her forearm",
          mood: "The image is explosive, morally charged, and balanced on irreversible choice",
        },
        dialogues: [round("别把答案也打碎！")],
      }),
    ],
  },
  {
    number: 35,
    pageFunction: "葵做出真正属于自己的选择。",
    emotion: "疼痛中的觉醒。",
    turn: "她不再替石动维持假平静，而是让被压住的真实浮上来。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "收束格",
        detail:
          "葵扑回控制台，迅速改写参数，原本柔白的广播波被拉成尖锐透明的形状，窗外城市里那些被压住的脸开始同时露出真实的痛苦、眼泪和惊醒般的呼吸。对白：“那就让他们听见自己！”",
        prompt: {
          shot: "A dramatic full-page transformation shot",
          scene: "the master console and city beyond the tower windows as the broadcast waveform changes shape mid-transmission",
          cast: [AOI],
          action:
            "Aoi rewrites the transmission at the console and the soft broadcast wave turns clear and piercing, forcing authentic grief and fear back onto the faces below",
          mood: "The image is cathartic, painful, and liberating rather than soothing",
        },
        dialogues: [round("那就让他们听见自己！")],
      }),
    ],
  },
  {
    number: 36,
    pageFunction: "让改变的后果立刻可见。",
    emotion: "秩序崩裂、真实回潮。",
    turn: "石动的‘完美平静’当场失效。",
    topology: "stacked",
    topologyLabel: "上下二分",
    panels: [
      panel({
        position: "上半页",
        shotLabel: "中景",
        detail:
          "诊所里的病人们终于不再整齐安静，有人抱头痛哭，有人惊恐喘息，头戴设备从耳边滑落，白得过分的空间第一次显得像病房。",
        prompt: {
          shot: "A medium consequence shot",
          scene: "the previously serene clinic waiting room now breaking into disordered human reactions",
          cast: [PATIENT_GROUP],
          action:
            "Patients cry, gasp, and clutch themselves as their transparent headsets slip off and the perfectly controlled room becomes recognizably human again",
          mood: "The image is chaotic, painful, and undeniably alive",
        },
      }),
      panel({
        position: "下半页",
        shotLabel: "近景",
        detail:
          "石动的笑终于裂开，他望着失控的监控反馈，像第一次真正看见他口中的‘病人’也是会反抗的人。对白：“你们只是把噪音重新放大了。”",
        prompt: {
          shot: "A close villain-break shot",
          scene: "Isurugi at the tower console with harsh warning graphics and broken reflection light on his glasses",
          cast: [ISURUGI],
          action:
            "Isurugi's polished smile collapses as he watches the feedback spiral out of his control for the first time",
          mood: "The mood is bitter, exposed, and stripped of authority",
        },
        dialogues: [round("你们只是把噪音重新放大了。")],
      }),
    ],
  },
  {
    number: 37,
    pageFunction: "把冲突收束到司法执行。",
    emotion: "冷静落槌。",
    turn: "朱完成她的选择：抓人，不替系统逃避真相。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "警报声中，常守持枪压制石动，另一只手把蹲在控制台边的葵护在自己身后，狡啮站在侧后方没有再开枪，三人的位置第一次不再互相撕扯。对白：“石动廉，你被以非法操控精神状态和连环致死嫌疑拘捕。”",
        prompt: {
          shot: "A medium arrest shot",
          scene: "the tower control room after the signal reversal with alarms still flashing and city light beyond broken calm",
          cast: [AKANE_FIELD, AOI, ISURUGI, KOGAMI_FIELD],
          action:
            "Akane arrests Isurugi at gunpoint while shielding the crouched Aoi behind her and Kogami holds position instead of firing",
          mood: "The image is decisive, balanced, and morally hard-won",
        },
        dialogues: [round("石动廉，你被以非法操控精神状态和连环致死嫌疑拘捕。")],
      }),
    ],
  },
  {
    number: 38,
    pageFunction: "进入后果阶段，给葵一个新的情绪位置。",
    emotion: "疲惫后的微温。",
    turn: "葵没有被直接消音，她还会被当作证人留下。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "中景",
        detail:
          "黎明前的列车车厢被灰蓝晨光填满，葵坐在靠窗位置，手里没有耳机，只剩一张薄毯和温热饮料，她看着玻璃外逐渐亮起来的城市。对白：“原来安静不是听不见。”",
        prompt: {
          shot: "A quiet medium aftermath shot",
          scene: "an early-morning transit carriage filled with gray-blue dawn light and a waking city outside the window",
          cast: [AOI],
          action:
            "Aoi sits by the window without her headphones, holding a warm drink and staring out at the slowly brightening city in exhausted thought",
          mood: "The image is soft, tired, and tentatively healing",
        },
        dialogues: [thought("原来安静不是听不见。")],
      }),
    ],
  },
  {
    number: 39,
    pageFunction: "制度结案，但不让制度赢得太轻松。",
    emotion: "克制的余震。",
    turn: "案件被记录为解决，但朱心里留下明确判断。",
    topology: "sideBySide",
    topologyLabel: "左右二分",
    panels: [
      panel({
        position: "左半页",
        shotLabel: "中景",
        detail:
          "指挥室恢复成平时的蓝色秩序，宜野座对着高层投影汇报结案，西比拉的白色轮廓只作为无脸发光体悬在背景。对白：“主要嫌疑人拘捕，次级涉案者转为保护证人。”",
        prompt: {
          shot: "A medium debrief shot",
          scene: "the MWPSB command room returned to disciplined blue order with a faceless white administrative hologram in the background",
          cast: [GINOZA],
          action:
            "Ginoza delivers the formal case summary toward the higher-level hologram while the room settles back into procedural calm",
          mood: "The image is controlled, official, and emotionally incomplete",
        },
        dialogues: [round("主要嫌疑人拘捕，次级涉案者转为保护证人。")],
      }),
      panel({
        position: "右半页",
        shotLabel: "近景",
        detail:
          "常守站在玻璃后方，表情平静，却没有一秒真的放松，像把结案书和疑问一起收进了身体里。对白：“系统可以结案，人还得继续活。”",
        prompt: {
          shot: "A close reflective shot",
          scene: "Akane behind a glass partition with soft command-room light and distant city brightness beyond",
          cast: [AKANE_OFFICE],
          action:
            "Akane stands alone after the briefing with a calm face that still carries the unresolved weight of the case inside it",
          mood: "The panel is restrained, thoughtful, and quietly defiant",
        },
        dialogues: [thought("系统可以结案，人还得继续活。")],
      }),
    ],
  },
  {
    number: 40,
    pageFunction: "尾声，回到城市与两位主角的关系。",
    emotion: "仍然不安，但已经更清醒。",
    turn: "整部一话以带刺的希望结束。",
    topology: "full",
    topologyLabel: "整页大格",
    panels: [
      panel({
        position: "整页",
        shotLabel: "远景",
        detail:
          "天刚亮的高楼天台上，风把夜雨最后一点水汽吹散，常守和狡啮并肩看向苏醒中的新东京，城市依旧巨大、冷硬，却不再像前一夜那样完全无声。对白：“这座城迟早还会再想把人修剪整齐。”“那就一次次把它弄乱。”",
        prompt: {
          shot: "A wide dawn epilogue shot",
          scene: "a skyscraper rooftop at dawn overlooking a waking futuristic Tokyo with rain haze thinning into gold-gray light",
          cast: [AKANE_FIELD, KOGAMI_FIELD],
          action:
            "Akane and Kogami stand side by side at the edge of the roof and watch the city wake after the night of false calm",
          mood: "The image is sober, hopeful, and sharpened by unresolved vigilance",
        },
        dialogues: [round("这座城迟早还会再想把人修剪整齐。"), round("那就一次次把它弄乱。")],
      }),
    ],
  },
];

export const PAGE_COUNT = PAGES.length;
export const PANEL_COUNT = PAGES.reduce((sum, page) => sum + page.panels.length, 0);

export const projectPaths = (projectRoot) => ({
  sourceDocPath: path.join(projectRoot, "docs", "projects", `${PROJECT_SLUG}.source.md`),
  outputDocPath: path.join(projectRoot, "docs", "projects", `${PROJECT_SLUG}.md`),
  templateProjectPath: path.join(projectRoot, "src", "generated", "psychopassGreyNoiseProject.json"),
  projectDir: path.join(projectRoot, "projects", PROJECT_FOLDER),
  projectJsonPath: path.join(projectRoot, "projects", PROJECT_FOLDER, "project.json"),
  assetsDir: path.join(projectRoot, "projects", PROJECT_FOLDER, "assets"),
  metaPath: path.join(projectRoot, "projects", ".latest_project"),
});
