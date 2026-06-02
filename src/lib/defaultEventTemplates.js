// 內建共用活動模板（來源：普宜精舍 2026-05-26 匯出，封面圖需各院自行上傳）
// 更新方式：普宜精舍重新匯出後，貼上新 JSON 取代 events 陣列

export const DEFAULT_TEMPLATES = [
  {
    "name": "中秋月光禪會暨護法會餐敘",
    "description": "欣逢中秋佳節，中台禪寺特別舉辦「中秋月光禪會暨各精舍聯合結業頒證法會」，匯聚本山僧眾、各精舍學員及護法檀那共襄盛舉，於團圓的溫馨氛圍中同沐法樂。屆時恭請大和尚親臨開示禪宗心要，期勉大眾澄心觀照、契悟自性明月。最後，大眾將於悠閒經行賞月間，共同祈願心光普照、社會大同祥和。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "夏安居藥師報恩法會暨盂蘭盆法會",
    "description": "七月孝親之月，中台禪寺啟建夏安居報恩藥師圓滿法會、護法會頒證大典、大蒙山施食及盂蘭盆法會，多項殊勝法會同期舉行。大眾稱念藥師如來聖號，以圓滿夏安居修行功德，回向一切眾生；盂蘭盆法會則依《盂蘭盆經》所示，廣設供品供養十方僧寶，祈願七世父母、現世親眷皆得離苦得樂，是報恩孝親的最佳時機。護法會頒證典禮同步舉行，表彰護法菩薩的護持道心。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "mountain",
    "is_dharma": false,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [
      {
        "field_key": "identity",
        "field_label": "身分別",
        "field_type": "radio",
        "options": [
          "義工",
          "信眾"
        ],
        "show_if": null,
        "sort_order": 1,
        "required": true,
        "dashboard_role": "identity",
        "option_meta": null
      },
      {
        "field_key": "arrive_time",
        "field_label": "預計到達山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 2,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_up",
        "field_label": "去程交通方式",
        "field_type": "radio",
        "options": [
          "搭精舍車（大車）",
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 3,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_up",
        "field_label": "去程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_up": "搭學員的車"
        },
        "sort_order": 4,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_up",
        "field_label": "去程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_up": "自行開車"
        },
        "sort_order": 5,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "leave_time",
        "field_label": "預計離開山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 6,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_down",
        "field_label": "回程交通方式",
        "field_type": "radio",
        "options": [
          "搭精舍車（大車）",
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 7,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_down",
        "field_label": "回程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_down": "搭學員的車"
        },
        "sort_order": 8,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_down",
        "field_label": "回程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_down": "自行開車"
        },
        "sort_order": 9,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "volunteer_group",
        "field_label": "發心組別",
        "field_type": "radio",
        "options": [
          "交通組",
          "行堂組",
          "茶水間",
          "大寮",
          "客寮",
          "機動組",
          "環保組",
          "大會安排",
          "其他"
        ],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 10,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_overnight",
        "field_label": "是否掛單",
        "field_type": "boolean",
        "options": [],
        "show_if": null,
        "sort_order": 11,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_start",
        "field_label": "掛單開始日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 12,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_end",
        "field_label": "掛單結束日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 13,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "note_to_temple",
        "field_label": "備註",
        "field_type": "text",
        "options": [],
        "show_if": null,
        "sort_order": 14,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      }
    ],
    "session_fields": []
  },
  {
    "name": "供佛齋僧法會",
    "description": "佛制結夏安居，為出家僧侶三個月的精進修行期。十方居士於此期間發心供養清淨僧寶，隨喜齋僧，功德等同供養十方三世一切諸佛，是積累福慧資糧最殊勝的因緣之一。《佛說盂蘭盆經》云，供養一切自恣僧眾，能令現世父母、七世父母離餓鬼苦。歡迎護法居士踴躍報名，共沾法喜，同植善根。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "mountain",
    "is_dharma": false,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [
      {
        "field_key": "identity",
        "field_label": "身分別",
        "field_type": "radio",
        "options": [
          "義工",
          "信眾"
        ],
        "show_if": null,
        "sort_order": 1,
        "required": true,
        "dashboard_role": "identity",
        "option_meta": null
      },
      {
        "field_key": "arrive_time",
        "field_label": "預計到達山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 2,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_up",
        "field_label": "去程交通方式",
        "field_type": "radio",
        "options": [
          "搭精舍車（大車）",
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 3,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_up",
        "field_label": "去程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_up": "搭學員的車"
        },
        "sort_order": 4,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_up",
        "field_label": "去程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_up": "自行開車"
        },
        "sort_order": 5,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "leave_time",
        "field_label": "預計離開山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 6,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_down",
        "field_label": "回程交通方式",
        "field_type": "radio",
        "options": [
          "搭精舍車（大車）",
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 7,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_down",
        "field_label": "回程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_down": "搭學員的車"
        },
        "sort_order": 8,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_down",
        "field_label": "回程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_down": "自行開車"
        },
        "sort_order": 9,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "volunteer_group",
        "field_label": "發心組別",
        "field_type": "radio",
        "options": [
          "交通組",
          "行堂組",
          "茶水間",
          "大寮",
          "客寮",
          "機動組",
          "環保組",
          "大會安排",
          "其他"
        ],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 10,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_overnight",
        "field_label": "是否掛單",
        "field_type": "boolean",
        "options": [],
        "show_if": null,
        "sort_order": 11,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_start",
        "field_label": "掛單開始日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 12,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_end",
        "field_label": "掛單結束日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 13,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "note_to_temple",
        "field_label": "備註",
        "field_type": "text",
        "options": [],
        "show_if": null,
        "sort_order": 14,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      }
    ],
    "session_fields": []
  },
  {
    "name": "星燈營",
    "description": "專為青少年設計的禪修體驗營，以「點亮心中一盞燈」為核心精神，在山林清淨的環境中，融合禪坐修行、正念生活與佛法課程，引導青少年學員開啟智慧的明燈。三天兩夜的營隊生活，遠離3C誘惑，透過互動課程與師父的引導，培養專注力、提升自信，建立正確的人生觀與價值觀，是青少年暑假期間最有意義的心靈成長之旅。報名請直接洽詢精舍。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": true,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "夏季學界精進禪七",
    "description": "暑假期間專為學界舉辦的精進禪七，是許多學員年復一年期待的修行盛事。七天的禪修訓練，從坐香到行香，從課誦到法師開示，幫助學界人士在繁忙的課業與工作之餘，找回清明自在的心。遠離城市喧囂，在中台禪寺莊嚴清淨的環境中，體驗「靜則一念不生，動則萬善圓彰」的禪修境界，是學界人士難得的年度心靈假期。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [
      {
        "field_key": "identity",
        "field_label": "身分別",
        "field_type": "radio",
        "options": [
          "義工",
          "信眾"
        ],
        "show_if": null,
        "sort_order": 1,
        "required": true,
        "dashboard_role": "identity",
        "option_meta": null
      },
      {
        "field_key": "arrive_time",
        "field_label": "預計到達山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 2,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_up",
        "field_label": "去程交通方式",
        "field_type": "radio",
        "options": [
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 3,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_up",
        "field_label": "去程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_up": "搭學員的車"
        },
        "sort_order": 4,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_up",
        "field_label": "去程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_up": "自行開車"
        },
        "sort_order": 5,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "leave_time",
        "field_label": "預計離開山上時間",
        "field_type": "datetime",
        "options": [],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 6,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "transport_down",
        "field_label": "回程交通方式",
        "field_type": "radio",
        "options": [
          "搭學員的車",
          "自行開車",
          "其他"
        ],
        "show_if": null,
        "sort_order": 7,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "carpool_down",
        "field_label": "回程共乘者（司機學員姓名）",
        "field_type": "text",
        "options": [],
        "show_if": {
          "transport_down": "搭學員的車"
        },
        "sort_order": 8,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "plate_down",
        "field_label": "回程車牌號碼",
        "field_type": "plate",
        "options": [],
        "show_if": {
          "transport_down": "自行開車"
        },
        "sort_order": 9,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "volunteer_group",
        "field_label": "發心組別",
        "field_type": "radio",
        "options": [
          "交通組",
          "行堂組",
          "茶水間",
          "大寮",
          "客寮",
          "機動組",
          "環保組",
          "大會安排",
          "其他"
        ],
        "show_if": {
          "identity": "義工"
        },
        "sort_order": 10,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_overnight",
        "field_label": "是否掛單",
        "field_type": "boolean",
        "options": [],
        "show_if": null,
        "sort_order": 11,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_start",
        "field_label": "掛單開始日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 12,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "stay_end",
        "field_label": "掛單結束日期",
        "field_type": "date",
        "options": [],
        "show_if": {
          "stay_overnight": true
        },
        "sort_order": 13,
        "required": true,
        "dashboard_role": null,
        "option_meta": null
      },
      {
        "field_key": "note_to_temple",
        "field_label": "備註",
        "field_type": "text",
        "options": [],
        "show_if": null,
        "sort_order": 14,
        "required": false,
        "dashboard_role": null,
        "option_meta": null
      }
    ],
    "session_fields": []
  },
  {
    "name": "浴佛法會暨夏安居報恩藥師法會",
    "description": "農曆四月初八為釋迦牟尼佛聖誕，大眾以香湯浴灌太子聖像，象徵洗滌煩惱塵垢、澄淨身心，具足清淨之功德。同時啟建夏安居報恩藥師法會，稱念藥師琉璃光如來聖號，祈願消災解厄、延壽增慧，以清淨殊勝的功德，回向家人親眷皆得平安健康，歡迎十方善信闔家前來共沾法喜。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "開山祖忌法會",
    "description": "謹以至誠之心，紀念中台禪寺開山住持惟覺安公老和尚。老和尚一生弘法利生，創建中台禪寺及遍布海內外的精舍道場，廣度無量眾生。法會禮讚祖師悲願，感念慧命再造之恩，並祈願道場法燈永續、弟子精進不退。全球各精舍同步連線參與，十方弟子同一時刻表達對祖師的無盡懷念與感恩。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "春季大眾精進禪七",
    "description": "每年春季盛事，開放海內外各地禪修班學員報名參加的精進禪七。在莊嚴的禪堂中，大眾朝參暮禮，從早課到晚課，每日十支香，在動靜之間反觀自照、淬鍊自心。七天的靜心薰修，讓人遠離日常紛擾，深化禪修功夫，長養菩提心苗。凡中級禪修班以上之在籍學員皆可向精舍報名，名額有限，請把握因緣。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "除夕圍爐暨新春合禮團拜",
    "description": "歡迎十方善信回山過年！除夕夜與師父們共進溫馨圍爐年菜，感受佛門大家庭的溫暖情懷；新春合禮團拜，大眾著居士服，同聲吟唱供養讚、禮佛、發願，在莊嚴的法喜中許下新年最美的心願。初一至初三，中台禪寺各殿堂開放參觀巡禮，歡迎與家人共赴菩提聖地，以感恩與清淨心迎接嶄新一年。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "春季學界精進禪七",
    "description": "專為學界人士舉辦的禪修密集課程，七天七夜在住持大和尚主七下，透過坐香、行香、早晚課誦，返觀自心，開發心地智慧。禪七期間一切作息依禪門規矩進行，遠離塵囂、息諸緣務，是學界人士深化修行、找回清明心境的最佳機緣。每年吸引來自台灣、美國、澳洲、義大利、香港、日本等海內外學界人士逾千人共聚禪堂精進用功，更有數百位義工發心護七。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "臘八掃塔法會",
    "description": "經云：「諸佛如來以大悲心而為體故，因於眾生而起大悲，因於大悲生菩提心，因菩提心成等正覺。」三千多年前，佛陀為救拔一切眾生離苦得樂，於臘八夜契悟無上正等正覺，慈悲示現成道之路，為眾生帶來解脫的智慧光明。開山祖師惟覺安公老和尚承佛悲願，一生行道，啟建中台道場，安僧度眾，德範化世。為紀念佛陀成道、感恩開山祖師化育深恩，舉行臘八掃塔法會，讓我們以知恩、感恩、報恩之心虔敬與會，和合精進，同讚佛恩，感懷祖德。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  },
  {
    "name": "傳授八關齋戒戒會",
    "description": "歲末跨年之際，中台禪寺一年一度傳授八關齋戒，讓在家居士以一日一夜的清淨戒行辭舊迎新。八關齋戒持八條淨戒、禮佛懺悔，在莊嚴法喜中迎接新年。受持一日一夜的戒行，功德不可思議。每年吸引來自海內外千位戒子歡喜受戒，是精舍學員最期盼的年度盛事之一，歡迎有心修學者踴躍報名。",
    "location": "中台禪寺",
    "location_tag": "zhongtai",
    "event_type": "temple",
    "is_dharma": true,
    "multi_session": false,
    "offline_registration": false,
    "cover_image_url": "",
    "related_links": [],
    "fields": [],
    "session_fields": []
  }
]
