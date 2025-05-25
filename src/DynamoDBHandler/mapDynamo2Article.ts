import { Article, Reaction } from '@interfaces/Article';

export const mapDynamoDBItemToArticle = (item: any): Article => {

    return {
      id: item.id.S,
      title: item.title.S,
      date: item.date.S,
      imageKind: item.imageKind.S,
      session: parseInt(item.session.N),
      nameOfHouse: item.nameOfHouse.S,
      nameOfMeeting: item.nameOfMeeting.S,
      category: item.category.S,
      description: item.description.S,
  
      summary: {
        id: parseInt(item.summary.M.id.N),
        summary: item.summary.M.summary.S,
        figure: item.summary.M.figure.S,
      },
      soft_summary: {
        id: parseInt(item.soft_summary.M.id.N),
        summary: item.soft_summary.M.summary.S,
      },
      middle_summary: item.middle_summary.L.map((ms: any) => ({
        order: parseInt(ms.M.order.N),
        summary: ms.M.summary.S,
        figure: ms.M.figure.S,
      })),
      dialogs: item.dialogs.L.map((dialog: any) => ({
        order: parseInt(dialog.M.order.N),
        speaker: dialog.M.speaker.S,
        speaker_group: dialog.M.speaker_group.S,
        speaker_position: dialog.M.speaker_position.S,
        speaker_role: dialog.M.speaker_role.S,
        summary: dialog.M.summary.S,
        soft_summary: dialog.M.soft_summary.S,
        response_to: dialog.M.response_to?.L
          ? dialog.M.response_to.L.map((response: any) => ({
              dialog_id: parseInt(response.M.dialog_id.N),
              reaction: response.M.reaction.S as Reaction,
            }))
          : [], // Default to an empty array if response_to is undefined
      })),
      participants: item.participants.L.map((participant: any) => ({
        name: participant.M.name.S,
        summary: participant.M.summary.S,
      })),
      terms: item.terms.L.map((term: any) => ({
        term: term.M.term.S,
        definition: term.M.definition.S,
      })),
      keywords: item.keywords.L.map((kw: any) => ({
        keyword: kw.M.keyword.S,
        priority: kw.M.priority.S as "high" | "medium" | "low",
      })),
    };
  };